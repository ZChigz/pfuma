import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiUnauthorized, apiError, apiNotFound, withApi } from '@/lib/api';
import { renderToStream } from '@react-pdf/renderer';
import { ReportCardDocument, type ReportCardData } from '@/components/results/ReportCardDocument';
import { createElement } from 'react';
import { requireTerm } from '@/lib/academic/terms';
import { fetchPdfImage } from '@/lib/system/pdf-image';
import { enrollmentFor } from '@/lib/academic/roster';
import { isoDate } from '@/lib/academic/terms';
import type { SessionUser } from '@/types';

export const runtime = 'nodejs';

async function _GET(
  req: NextRequest,
  { params }: { params: { studentId: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  const termId = new URL(req.url).searchParams.get('termId');
  if (!termId) return apiError('termId query parameter is required', 400);
  const termRow = await requireTerm(user.schoolId, termId, db);
  const term = termRow.name;

  const student = await db.student.findUnique({
    where: { id: params.studentId },
    include: {
      school:  { select: { name: true, motto: true, logoUrl: true, headName: true, headSignatureUrl: true } },
      marks: {
        where: { termId, schoolId: user.schoolId },
        include: { subject: { select: { name: true, maxMark: true } } },
        orderBy: { subject: { name: 'asc' } },
      },
      termResults: {
        where: { termId },
      },
    },
  });

  if (!student || student.schoolId !== user.schoolId) return apiNotFound('Student');

  const termResult = student.termResults[0] ?? null;
  // The class the student was in for that term, not their class today.
  const enrollment = await enrollmentFor(student.id, termId, db);

  // The date the next term starts: stored when the class was published, otherwise looked up now.
  const nextTermStart =
    termResult?.nextTermStartDate ??
    (await db.academicTerm.findFirst({
      where: { schoolId: user.schoolId, startDate: { gt: termRow.startDate } },
      orderBy: { startDate: 'asc' },
      select: { startDate: true },
    }))?.startDate ??
    null;

  // Images that fail to load are simply left off; they never stop the report card.
  const [logo, headSignature] = await Promise.all([fetchPdfImage(student.school.logoUrl), fetchPdfImage(student.school.headSignatureUrl)]);

  const reportData: ReportCardData = {
    schoolName:    student.school.name,
    motto:         student.school.motto,
    logo,
    headName:      student.school.headName,
    headSignature,
    studentName:   student.fullName,
    admissionNumber: student.admissionNumber,
    level:         enrollment?.class.level.name,
    stream:        enrollment?.class.stream || undefined,
    grade:         enrollment?.class.name ?? '—',
    term,
    classPosition: termResult?.classPosition ?? null,
    classSize:     termResult?.classSize ?? null,
    rankedOutOf:   termResult?.rankedOutOf ?? null,
    subjectsSat:   termResult?.subjectsTaken ?? termResult?.subjectsSat ?? null,
    subjectsOffered: termResult?.subjectsOffered ?? null,
    percentage:    termResult?.percentage?.toNumber() ?? 0,
    headRemark:    termResult?.headRemark ?? null,
    classTeacherRemark: termResult?.classTeacherRemark ?? null,
    daysPresent:   termResult?.daysPresent ?? null,
    daysAbsent:    termResult?.daysAbsent ?? null,
    nextTermStartDate: nextTermStart ? isoDate(nextTermStart) : null,
    marks: student.marks.map((m) => ({
      subjectName: m.subject.name,
      rawMark:     m.rawMark.toNumber(),
      maxMark:     m.subject.maxMark,
      percentage:  m.percentage?.toNumber() ?? 0,
      letterGrade: m.letterGrade,
      note:
        m.status === 'EXEMPT' ? 'Exempt' : m.status === 'ABSENT' ? (m.excused ? 'Absent (excused)' : 'Absent') : null,
    })),
  };

  const element = createElement(ReportCardDocument, { data: reportData });
  const pdfStream = await renderToStream(element);

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      pdfStream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      pdfStream.on('end',  () => controller.close());
      pdfStream.on('error', (err: Error) => controller.error(err));
    },
    cancel() {
      (pdfStream as unknown as { destroy?: () => void }).destroy?.();
    },
  });

  const safeName = student.fullName.replace(/[^a-zA-Z0-9]/g, '-');
  const safeTerm = term.replace(/[^a-zA-Z0-9]/g, '-');

  return new Response(readable, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName}-${safeTerm}.pdf"`,
    },
  });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/results/reports/[studentId]', _GET as H);

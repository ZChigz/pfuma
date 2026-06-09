import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiUnauthorized, apiError, apiNotFound, withApi } from '@/lib/api';
import { renderToStream } from '@react-pdf/renderer';
import { ReportCardDocument, type ReportCardData } from '@/components/results/ReportCardDocument';
import { createElement } from 'react';
import type { SessionUser } from '@/types';

export const runtime = 'nodejs';

async function _GET(
  req: NextRequest,
  { params }: { params: { studentId: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const term = new URL(req.url).searchParams.get('term');
  if (!term) return apiError('term query parameter is required', 400);

  const student = await prisma.student.findUnique({
    where: { id: params.studentId },
    include: {
      school:  { select: { name: true } },
      marks: {
        where: { term, schoolId: user.schoolId },
        include: { subject: { select: { name: true, maxMark: true } } },
        orderBy: { subject: { name: 'asc' } },
      },
      termResults: {
        where: { term },
      },
    },
  });

  if (!student || student.schoolId !== user.schoolId) return apiNotFound('Student');

  const termResult = student.termResults[0] ?? null;

  const reportData: ReportCardData = {
    schoolName:    student.school.name,
    studentName:   student.fullName,
    grade:         student.grade,
    term,
    classPosition: termResult?.classPosition ?? null,
    percentage:    termResult?.percentage?.toNumber() ?? 0,
    headRemark:    termResult?.headRemark ?? null,
    marks: student.marks.map((m) => ({
      subjectName: m.subject.name,
      rawMark:     m.rawMark.toNumber(),
      maxMark:     m.subject.maxMark,
      percentage:  m.percentage?.toNumber() ?? 0,
      letterGrade: m.letterGrade,
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

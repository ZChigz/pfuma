import { type NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { canExportResults } from '@/lib/permissions';
import type { SessionUser } from '@/types';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF065F46' },
};

const STRIPE_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF5F5F4' },
};

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canExportResults(user.role); }
  catch (e) { if (e instanceof Response) return e; throw e; }

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get('classId');
  const term    = searchParams.get('term');
  if (!classId || !term) return apiNotFound('Class');

  const schoolClass = await prisma.schoolClass.findFirst({
    where: { id: classId, schoolId: user.schoolId },
  });
  if (!schoolClass) return apiNotFound('Class');

  const school = await prisma.school.findUnique({
    where: { id: user.schoolId },
    select: { name: true },
  });

  const [assignments, students, marks] = await Promise.all([
    prisma.subjectAssignment.findMany({
      where: { schoolId: user.schoolId, classId, term },
      include: { subject: { select: { id: true, name: true, maxMark: true } } },
      orderBy: { subject: { name: 'asc' } },
    }),
    prisma.student.findMany({
      where: { schoolId: user.schoolId, classId, active: true },
      select: { id: true, fullName: true },
    }),
    prisma.mark.findMany({
      where: {
        schoolId:  user.schoolId,
        term,
        status:    { in: ['VERIFIED', 'PUBLISHED'] },
        student:   { classId },
      },
    }),
  ]);

  const termResults = await prisma.termResult.findMany({
    where: { schoolId: user.schoolId, term, studentId: { in: students.map((s) => s.id) } },
  });

  const subjects = assignments.map((a) => a.subject);
  const totalPossible = subjects.reduce((n, s) => n + s.maxMark, 0);

  const termResultByStudent = new Map(termResults.map((r) => [r.studentId, r]));
  const marksByStudent = new Map<string, Map<string, number>>();
  for (const m of marks) {
    if (!marksByStudent.has(m.studentId)) marksByStudent.set(m.studentId, new Map());
    marksByStudent.get(m.studentId)!.set(m.subjectId, m.rawMark.toNumber());
  }

  const rows = students
    .map((s) => {
      const tr = termResultByStudent.get(s.id);
      return {
        student: s,
        marks:   marksByStudent.get(s.id) ?? new Map<string, number>(),
        total:   tr?.totalMarks.toNumber() ?? null,
        percentage: tr?.percentage.toNumber() ?? null,
        position: tr?.classPosition ?? null,
      };
    })
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));

  // ─── Build workbook ──────────────────────────────────────────────────────
  const workbook = new ExcelJS.Workbook();
  const sheetName = `${schoolClass.name} ${term}`.slice(0, 31);
  const sheet = workbook.addWorksheet(sheetName);

  const columnCount = 3 + subjects.length + 3; // No., Name, [subjects...], Total, %, Position

  // Row 1: school name
  sheet.mergeCells(1, 1, 1, columnCount);
  const schoolNameCell = sheet.getCell(1, 1);
  schoolNameCell.value = school?.name ?? 'School';
  schoolNameCell.font = { bold: true, size: 14 };
  schoolNameCell.alignment = { horizontal: 'center' };

  // Row 2: class — term — Academic Results
  sheet.mergeCells(2, 1, 2, columnCount);
  const titleCell = sheet.getCell(2, 1);
  titleCell.value = `${schoolClass.name} — ${term} — Academic Results`;
  titleCell.font = { bold: true, size: 12 };
  titleCell.alignment = { horizontal: 'center' };

  // Row 3: blank

  // Row 4: header row
  const headerRow = sheet.getRow(4);
  headerRow.getCell(1).value = 'No.';
  headerRow.getCell(2).value = 'Student Name';
  subjects.forEach((subj, i) => {
    headerRow.getCell(3 + i).value = `${subj.name}\n(${subj.maxMark})`;
  });
  headerRow.getCell(3 + subjects.length).value = `Total (${totalPossible})`;
  headerRow.getCell(4 + subjects.length).value = 'Percentage';
  headerRow.getCell(5 + subjects.length).value = 'Position';

  for (let c = 1; c <= columnCount; c++) {
    const cell = headerRow.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
  headerRow.height = 30;

  // Rows 5+: students
  rows.forEach((row, idx) => {
    const r = sheet.getRow(5 + idx);
    r.getCell(1).value = row.position ?? idx + 1;
    r.getCell(2).value = row.student.fullName;
    r.getCell(2).font = { bold: true };

    subjects.forEach((subj, i) => {
      const cell = r.getCell(3 + i);
      const mark = row.marks.get(subj.id);
      cell.value = mark ?? '';
      cell.numFmt = '0';
      cell.alignment = { horizontal: 'center' };
    });

    const totalCell = r.getCell(3 + subjects.length);
    totalCell.value = row.total ?? '';
    totalCell.numFmt = '0';
    totalCell.alignment = { horizontal: 'center' };

    const pctCell = r.getCell(4 + subjects.length);
    pctCell.value = row.percentage ?? '';
    pctCell.numFmt = '0.0';
    pctCell.alignment = { horizontal: 'center' };

    const posCell = r.getCell(5 + subjects.length);
    posCell.value = row.position ?? '';
    posCell.font = { bold: true };
    posCell.alignment = { horizontal: 'center' };

    if (idx % 2 === 1) {
      for (let c = 1; c <= columnCount; c++) {
        r.getCell(c).fill = STRIPE_FILL;
      }
    }
  });

  // Final row: class average
  const avgRowIdx = 5 + rows.length;
  const avgRow = sheet.getRow(avgRowIdx);
  avgRow.getCell(1).value = '';
  avgRow.getCell(2).value = 'CLASS AVERAGE';
  avgRow.getCell(2).font = { bold: true };

  subjects.forEach((subj, i) => {
    const subjMarks = rows.map((row) => row.marks.get(subj.id)).filter((v): v is number => v != null);
    const avg = subjMarks.length > 0 ? subjMarks.reduce((a, b) => a + b, 0) / subjMarks.length : null;
    const cell = avgRow.getCell(3 + i);
    cell.value = avg ?? '';
    cell.numFmt = '0.0';
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center' };
  });

  const totals = rows.map((row) => row.total).filter((v): v is number => v != null);
  const avgTotal = totals.length > 0 ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
  const totalCell = avgRow.getCell(3 + subjects.length);
  totalCell.value = avgTotal ?? '';
  totalCell.numFmt = '0.0';
  totalCell.font = { bold: true };
  totalCell.alignment = { horizontal: 'center' };

  const percentages = rows.map((row) => row.percentage).filter((v): v is number => v != null);
  const avgPct = percentages.length > 0 ? percentages.reduce((a, b) => a + b, 0) / percentages.length : null;
  const pctCell = avgRow.getCell(4 + subjects.length);
  pctCell.value = avgPct ?? '';
  pctCell.numFmt = '0.0';
  pctCell.font = { bold: true };
  pctCell.alignment = { horizontal: 'center' };

  avgRow.getCell(5 + subjects.length).value = '';

  for (let c = 1; c <= columnCount; c++) {
    avgRow.getCell(c).fill = HEADER_FILL;
    if (c !== 2 && !avgRow.getCell(c).font?.bold) avgRow.getCell(c).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  }
  avgRow.getCell(2).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  // Column widths
  sheet.getColumn(1).width = 6;
  sheet.getColumn(2).width = 25;
  subjects.forEach((_, i) => { sheet.getColumn(3 + i).width = 12; });
  sheet.getColumn(3 + subjects.length).width = 10;
  sheet.getColumn(4 + subjects.length).width = 10;
  sheet.getColumn(5 + subjects.length).width = 10;

  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${schoolClass.name}_${term}_Results.xlsx"`,
    },
  });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/results/export', _GET as H);

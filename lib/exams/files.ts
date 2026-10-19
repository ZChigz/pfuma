// Spreadsheet files of the Examinations module: the mark template to fill in offline, reading an uploaded template back, and the
// class results sheet (broadsheet) with every student and subject. Excel files are made and read here; CSV works everywhere.
import ExcelJS from 'exceljs';
import { ServiceError } from '@/lib/api';
import { toCsv } from '@/lib/csv';
import { parseCsv } from '@/lib/students/csv';
import { getScopedDb } from '@/lib/scoped-db';
import { holds, isFull, num, resolveTerm, type Actor } from '@/lib/exams/common';
import { rowsFromTable, TableError } from '@/lib/exams/import-table';
import type { TemplateData } from '@/lib/exams/import';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14613F' } };

export function templateCsv(t: TemplateData): string {
  return toCsv(t.headers, t.rows);
}

export async function templateXlsx(t: TemplateData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Marks');
  ws.addRow(t.headers);
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = HEADER_FILL;
  for (const r of t.rows) ws.addRow(r);
  ws.columns = [{ width: 20 }, { width: 34 }, { width: 14 }];
  ws.getColumn(1).numFmt = '@';
  ws.addRow([]);
  ws.addRow([`${t.title}: out of ${t.max}. Type a mark, or AB (absent), EX (exempt) or NS (not submitted). Leave empty to keep the mark as it is.`]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'result' in v) return String((v as { result?: unknown }).result ?? '');
  if (typeof v === 'object' && 'text' in v) return String((v as { text: unknown }).text);
  return String(v);
};

/** The rows of an uploaded template: CSV or Excel. */
export async function rowsFromFile(name: string, bytes: Buffer) {
  if (bytes.length > 2 * 1024 * 1024) throw new ServiceError('The file is too large (2 MB at most)', 422);
  let table: string[][];
  if (/\.xlsx$/i.test(name)) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(bytes as never); } catch { throw new ServiceError('That file could not be read as an Excel workbook', 422); }
    const ws = wb.worksheets[0];
    if (!ws) throw new ServiceError('The workbook is empty', 422);
    table = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (c, i) => { cells[i - 1] = cellText(c.value); });
      table.push(Array.from(cells, (c) => c ?? ''));
    });
  } else if (/\.(csv|txt)$/i.test(name)) {
    table = parseCsv(bytes.toString('utf8'));
  } else {
    throw new ServiceError('Upload the template as a CSV or Excel (.xlsx) file', 422);
  }
  try {
    return rowsFromTable(table);
  } catch (e) {
    if (e instanceof TableError) throw new ServiceError(e.message, 422);
    throw e;
  }
}

/** Any table as a workbook with a bold green header row. */
export async function tableXlsx(title: string, headers: string[], rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title.slice(0, 30) || 'Sheet 1');
  const head = ws.addRow(headers);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = HEADER_FILL;
  for (const r of rows) ws.addRow(r);
  ws.columns.forEach((c, i) => { c.width = i === 0 ? 20 : 16; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─── Class results sheet (broadsheet) ────────────────────────────────────────

export interface BroadsheetScope { termId?: string; classId?: string; levelId?: string }

export async function broadsheetXlsx(user: Actor, scope: BroadsheetScope): Promise<{ fileName: string; buffer: Buffer }> {
  if (!isFull(user) && !holds(user, 'exams.results.view') && !holds(user, 'exams.results.publish')) throw new ServiceError('Forbidden', 403);
  if (!scope.classId && !scope.levelId) throw new ServiceError('Choose a class or a form', 422);
  const data = await getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const term = await resolveTerm(tx, sid, scope.termId);
    const classes = await tx.schoolClass.findMany({ where: { schoolId: sid, ...(scope.classId ? { id: scope.classId } : { levelId: scope.levelId }) }, select: { id: true, name: true, level: { select: { name: true, category: true } } }, orderBy: { name: 'asc' } });
    if (classes.length === 0) throw new ServiceError('Class not found', 404);
    const termRows = await tx.termResult.findMany({ where: { schoolId: sid, termId: term.id, classId: { in: classes.map((c) => c.id) } }, include: { student: { select: { fullName: true, admissionNumber: true, surname: true, firstName: true } } } });
    const subjectRows = await tx.subjectResult.findMany({ where: { schoolId: sid, termId: term.id, classId: { in: classes.map((c) => c.id) } }, include: { subject: { select: { name: true } } } });
    const school = await tx.school.findUnique({ where: { id: sid }, select: { name: true } });
    return { term, classes, termRows, subjectRows, school };
  });
  const subjects = Array.from(new Set(data.subjectRows.map((r) => r.subject.name))).sort();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Results');
  const oLevel = data.classes[0]!.level.category === 'O_LEVEL';
  const title = scope.classId ? data.classes[0]!.name : data.classes[0]!.level.name;
  const draft = data.termRows.some((r) => !r.published);
  ws.addRow([`${data.school?.name ?? ''}: ${title}, ${data.term.name}${draft ? ' (DRAFT: not all results are published)' : ''}`]);
  ws.getRow(1).font = { bold: true, size: 13 };
  ws.addRow([]);
  const head = ['Position', 'Admission no.', 'Name', 'Class', ...subjects.flatMap((s) => [s, '']), 'Average %', 'Class pos.', 'Form pos.', oLevel ? 'Passes' : 'Points (best 3)', ...(oLevel ? ['5+ incl. Eng & Maths'] : [])];
  const h = ws.addRow(head);
  const sub = ws.addRow(['', '', '', '', ...subjects.flatMap(() => ['Mark', 'Grade'])]);
  for (const r of [h, sub]) { r.font = { bold: true, color: { argb: 'FFFFFFFF' } }; r.fill = HEADER_FILL; }
  for (let i = 0; i < subjects.length; i++) ws.mergeCells(3, 5 + i * 2, 3, 6 + i * 2);
  const className = new Map(data.classes.map((c) => [c.id, c.name]));
  const rows = [...data.termRows].sort((a, b) => (num(b.averagePercentage) ?? 0) - (num(a.averagePercentage) ?? 0));
  for (const r of rows) {
    const mine = data.subjectRows.filter((s) => s.studentId === r.studentId);
    ws.addRow([
      r.classPosition ?? '', r.student.admissionNumber, `${r.student.surname.toUpperCase()}, ${r.student.firstName}`, className.get(r.classId!) ?? '',
      ...subjects.flatMap((name) => { const m = mine.find((x) => x.subject.name === name); return m ? [m.roundedMark, m.grade ?? ''] : ['', '']; }),
      num(r.averagePercentage) ?? '', r.classPosition ?? '', r.formPosition ?? '', (oLevel ? r.subjectsPassed : r.aLevelPoints) ?? '',
      ...(oLevel ? [r.fivePassesEngMaths === null ? '' : r.fivePassesEngMaths ? 'Yes' : 'No'] : []),
    ]);
  }
  ws.columns.forEach((c, i) => { c.width = i === 2 ? 28 : i < 4 ? 14 : 9; });
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 4 }];
  return { fileName: `Results ${title} ${data.term.name}.xlsx`.replace(/[^A-Za-z0-9._ -]/g, '-'), buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
}

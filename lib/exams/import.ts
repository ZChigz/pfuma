// Importing marks from a file. The teacher downloads a pre-filled template for one assessment (admission number, name, mark),
// fills it in offline, uploads it, reviews the errors and confirms. Nothing is saved until they confirm; confirming sends the
// good rows through the same saveMarks as the grid, so every rule (maximum, codes, locked sheets, history) applies.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { markKey } from '@/lib/results';
import { cellText, parseCell } from '@/lib/exams/cell';
import { TEMPLATE_HEADERS, type ImportReview, type ReviewRow } from '@/lib/exams/import-table';
import { assertOwnAssignment, holds, idSchema, loadAssignment, rosterOf, assessmentsOf, num, type Actor } from '@/lib/exams/common';


export type { ImportReview, ReviewRow, RowStatus } from '@/lib/exams/import-table';
export { TEMPLATE_HEADERS, rowsFromTable } from '@/lib/exams/import-table';

export interface TemplateData { fileName: string; title: string; max: number; headers: string[]; rows: (string | number)[][] }

const Target = z.object({ assignmentId: idSchema, assessmentId: idSchema, stageId: idSchema.nullish() });

async function targetOf(user: Actor, raw: unknown) {
  const input = Target.parse(raw);
  const db = getScopedDb(user.schoolId, user.id);
  return db.$tx(async (tx) => {
    const a = await loadAssignment(tx, user.schoolId, input.assignmentId);
    if (!holds(user, 'exams.marks.view')) assertOwnAssignment(user, a, 'exams.marks.enter');
    const assessments = await assessmentsOf(tx, user.schoolId, a);
    const asm = assessments.find((x) => x.id === input.assessmentId);
    if (!asm) throw new ServiceError('Assessment not found', 404);
    let max = num(asm.maxMark)!;
    let stageName: string | null = null;
    if (asm.projectId) {
      const stage = input.stageId ? await tx.projectStage.findFirst({ where: { id: input.stageId, schoolId: user.schoolId, templateId: asm.projectId }, include: { rubric: { select: { id: true } } } }) : null;
      if (!stage) throw new ServiceError('Choose a stage of the project', 422);
      if (stage.rubric) throw new ServiceError('This stage is marked with a rubric, so it cannot be imported', 422);
      max = num(stage.maxMark)!;
      stageName = stage.name;
    } else if (input.stageId) throw new ServiceError('This assessment has no stages', 422);
    const roster = await rosterOf(tx, user.schoolId, a);
    const marks = await tx.assessmentMark.findMany({ where: { schoolId: user.schoolId, assignmentId: a.id, assessmentId: asm.id, stageId: input.stageId ?? null } });
    return { a, asm, max, stageName, roster, marks, stageId: input.stageId ?? null };
  });
}

/** The pre-filled template for one assessment: every student of the class, with the mark they have now. */
export async function buildTemplate(user: Actor, raw: unknown): Promise<TemplateData> {
  const t = await targetOf(user, raw);
  const byStudent = new Map(t.marks.map((m) => [m.studentId, m]));
  const title = t.stageName ? `${t.asm.title}: ${t.stageName}` : t.asm.title;
  return {
    fileName: `${t.a.subject.name} ${t.a.class?.name ?? t.a.group?.name ?? ''} ${title}`.replace(/\s+/g, ' ').trim(),
    title, max: t.max,
    headers: TEMPLATE_HEADERS,
    rows: t.roster.map((s) => {
      const m = byStudent.get(s.id);
      return [s.admissionNumber, `${s.surname.toUpperCase()}, ${s.firstName}`, cellText(m ? { value: num(m.value), code: m.code } : undefined)];
    }),
  };
}

import { MAX_IMPORT_ROWS } from '@/lib/exams/import-table';

const RowsSchema = z.object({ rows: z.array(z.object({ admissionNumber: z.string().max(60), name: z.string().max(200).optional(), mark: z.string().max(40) })).min(1, 'The file has no rows').max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} rows at a time`) });

/** Checks each row of an uploaded file against the class list and the maximum mark, without saving anything. */
export async function previewImport(user: Actor, raw: unknown): Promise<ImportReview> {
  const t = await targetOf(user, raw);
  const { rows } = RowsSchema.parse(raw);
  const byAdmission = new Map(t.roster.map((s) => [s.admissionNumber.trim().toUpperCase(), s]));
  const current = new Map(t.marks.map((m) => [markKey(m.studentId, m.assessmentId, m.stageId), m]));
  const seen = new Set<string>();
  const out: ReviewRow[] = [];
  rows.forEach((r, i) => {
    const adm = r.admissionNumber.trim();
    const base = { line: i + 2, admissionNumber: adm, name: r.name?.trim() ?? '', raw: r.mark.trim() };
    const fail = (message: string, before = ''): ReviewRow => ({ ...base, status: 'ERROR', message, cell: null, before });
    const student = byAdmission.get(adm.toUpperCase());
    if (!adm) { out.push(fail('No admission number')); return; }
    if (!student) { out.push(fail('This admission number is not on the class list for this subject')); return; }
    if (seen.has(student.id)) { out.push(fail('This student appears twice in the file')); return; }
    seen.add(student.id);
    const cur = current.get(markKey(student.id, t.asm.id, t.stageId));
    const before = cellText(cur ? { value: num(cur.value), code: cur.code } : undefined);
    const p = parseCell(r.mark, t.max);
    if (!p.ok) { out.push({ ...fail(p.message, before), name: r.name?.trim() || `${student.surname.toUpperCase()}, ${student.firstName}` }); return; }
    const name = `${student.surname.toUpperCase()}, ${student.firstName}`;
    // An empty cell in the file leaves the mark as it is (it never clears one).
    if (p.cell.value === null && p.cell.code === null) { out.push({ ...base, name, status: 'UNCHANGED', message: 'Empty: left as it is', cell: null, before }); return; }
    if (cur?.code === 'AB_EXCUSED') { out.push({ ...fail('The Head excused this absence, so it cannot be changed here', before), name }); return; }
    const same = (num(cur?.value) ?? null) === p.cell.value && (cur?.code ?? null) === p.cell.code;
    out.push({
      ...base, name, status: same ? 'UNCHANGED' : 'OK', message: same ? 'Same as now' : null, before,
      cell: same ? null : { studentId: student.id, assessmentId: t.asm.id, stageId: t.stageId, value: p.cell.value, code: p.cell.code },
    });
  });
  const inFile = new Set(rows.map((r) => r.admissionNumber.trim().toUpperCase()));
  const notInFile = t.roster.filter((s) => !inFile.has(s.admissionNumber.trim().toUpperCase())).map((s) => ({ admissionNumber: s.admissionNumber, name: `${s.surname.toUpperCase()}, ${s.firstName}` }));
  return {
    title: t.stageName ? `${t.asm.title}: ${t.stageName}` : t.asm.title, max: t.max, rows: out, notInFile,
    counts: { ok: out.filter((r) => r.status === 'OK').length, unchanged: out.filter((r) => r.status === 'UNCHANGED').length, errors: out.filter((r) => r.status === 'ERROR').length, total: out.length },
  };
}

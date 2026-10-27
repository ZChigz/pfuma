// Mark entry: the grid a teacher fills in, and the one function that writes marks.
//
//  • A mark belongs to a student, an assessment and a teacher assignment. Who can enter it comes from the assignment; who sits
//    it comes from StudentSubject (the roster).
//  • Marks are never deleted. Once a sheet has been submitted for the first time, every change keeps the old value, the new
//    value, who, when and why (AssessmentMarkChange).
//  • A mark above the maximum, below 0 or not a number is refused. Warnings (allowed): far from the class mean, and AB for a
//    student the register shows present that day.
//  • Saving is safe to repeat: offline entries carry the time they were typed and the later version of a cell wins.
import { z } from 'zod';
import type { MarkCode, Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { classStats, outliers, previewTermMarks, markKey, type CalcAssessment, type PlanLine, type ScaleBand, type StoredMark, type StudentPreview } from '@/lib/results';
import { columnKey, parseCell } from '@/lib/exams/cell';
import {
  EDITABLE, STATUS_LABEL, assertOwnAssignment, assessmentsOf, classNameOf, ensureSheet, holds, idSchema, levelIdOf, loadAssignment,
  loadExamSettings, num, rosterOf, type Actor, type LoadedAssignment, type RosterStudent,
} from '@/lib/exams/common';
import { planAndScale } from '@/lib/exams/scales';
import { openForEntry } from '@/lib/exams/entry';

// ─── What the grid shows ─────────────────────────────────────────────────────

export interface GridColumn {
  key: string;
  assessmentId: string;
  stageId: string | null;
  title: string;
  stageName: string | null;
  typeName: string;
  max: number;
  date: string | null;
  countsToTerm: boolean;
  common: boolean;
  /** A rubric stage: its mark is the total of the clicked levels, so it is not typed. */
  rubric: boolean;
  isProject: boolean;
}

export interface GridMark { v: number | null; c: MarkCode | null; t: string }

export interface GridSheet {
  id: string | null;
  status: keyof typeof STATUS_LABEL;
  firstSubmittedAt: string | null;
  returnedComment: string | null;
  unlockReason: string | null;
  /** Changes need a reason (the sheet has been submitted before). */
  needsReason: boolean;
}

export interface Grid {
  assignmentId: string;
  termId: string;
  termName: string;
  subjectName: string;
  className: string;
  teacherName: string;
  canEdit: boolean;
  sheet: GridSheet;
  columns: GridColumn[];
  assessments: (CalcAssessment & { title: string })[];
  students: { id: string; name: string; admissionNumber: string; gender: string | null }[];
  marks: Record<string, GridMark>;
  comments: Record<string, string>;
  plan: PlanLine[] | null;
  scale: ScaleBand[];
  passMark: number;
  outlierSd: number;
  commentsEnabled: boolean;
  /** Why the term mark cannot be calculated yet (no plan for this level and term). */
  planProblem: string | null;
  preview: Record<string, { termMark: number | null; roundedMark: number | null; grade: string | null; incomplete: boolean }>;
  /** Per column: how many students have a mark, and the class figures. */
  summary: Record<string, { entered: number; expected: number; mean: number | null; highest: number | null; lowest: number | null; passRate: number | null }>;
  /** Lessons or students warned about when the grid was opened (outliers). */
  warnings: Record<string, string>;
}

export const nameFor = (s: Pick<RosterStudent, 'surname' | 'firstName'>) => `${s.surname.toUpperCase()}, ${s.firstName}`;

/** Everything the grid needs for one teaching assignment's term. */
export async function loadGrid(user: Actor, assignmentId: string): Promise<Grid> {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await loadAssignment(tx, user.schoolId, assignmentId);
    const mayEdit = (holds(user, 'exams.marks.enter') && (a.teacherId === user.id || a.coTeacherId === user.id));
    if (!mayEdit && !holds(user, 'exams.marks.view') && !holds(user, 'exams.marks.verify')) assertOwnAssignment(user, a, 'exams.marks.enter');
    return buildGrid(tx, user, a, mayEdit);
  });
}

export async function buildGrid(tx: Db, user: Actor, a: LoadedAssignment, mayEdit: boolean): Promise<Grid> {
  const sid = user.schoolId;
  const levelId = levelIdOf(a);
  const [sheet, roster, assessments, ps, settings] = await Promise.all([
    tx.markSheet.findUnique({ where: { assignmentId_termId: { assignmentId: a.id, termId: a.termId } } }),
    rosterOf(tx, sid, a),
    assessmentsOf(tx, sid, a),
    planAndScale(tx, sid, a.termId, levelId, a.subjectId),
    loadExamSettings(tx, sid),
  ]);

  const projectIds = Array.from(new Set(assessments.map((x) => x.projectId).filter((x): x is string => !!x)));
  const stages = projectIds.length
    ? await tx.projectStage.findMany({ where: { schoolId: sid, templateId: { in: projectIds } }, include: { rubric: { select: { id: true } } }, orderBy: { sortOrder: 'asc' } })
    : [];

  const columns: GridColumn[] = [];
  const calc: (CalcAssessment & { title: string })[] = [];
  for (const x of assessments) {
    const base = { assessmentId: x.id, title: x.title, typeName: x.type.name, date: x.date ? x.date.toISOString().slice(0, 10) : null, countsToTerm: x.countsToTerm, common: x.assignmentId === null, isProject: x.type.isProject };
    if (x.projectId) {
      const mine = stages.filter((s) => s.templateId === x.projectId);
      calc.push({ id: x.id, title: x.title, typeId: x.typeId, maxMark: num(x.maxMark)!, countsToTerm: x.countsToTerm, stages: mine.map((s) => ({ id: s.id, maxMark: num(s.maxMark)! })) });
      for (const s of mine) columns.push({ ...base, key: columnKey(x.id, s.id), stageId: s.id, stageName: s.name, max: num(s.maxMark)!, rubric: !!s.rubric });
    } else {
      calc.push({ id: x.id, title: x.title, typeId: x.typeId, maxMark: num(x.maxMark)!, countsToTerm: x.countsToTerm });
      columns.push({ ...base, key: columnKey(x.id, null), stageId: null, stageName: null, max: num(x.maxMark)!, rubric: false });
    }
  }

  const markRows = assessments.length
    ? await tx.assessmentMark.findMany({ where: { schoolId: sid, assignmentId: a.id, assessmentId: { in: assessments.map((x) => x.id) } } })
    : [];
  const marks: Record<string, GridMark> = {};
  const lookup = new Map<string, StoredMark>();
  for (const m of markRows) {
    const key = markKey(m.studentId, m.assessmentId, m.stageId);
    marks[key] = { v: num(m.value), c: m.code, t: (m.clientChangedAt ?? m.updatedAt).toISOString() };
    lookup.set(key, { value: num(m.value), code: m.code });
  }

  const commentRows = sheet ? await tx.sheetStudentComment.findMany({ where: { sheetId: sheet.id } }) : [];
  const comments = Object.fromEntries(commentRows.map((c) => [c.studentId, c.text]));

  const planLines = ps.plan?.lines ?? null;
  const preview: Grid['preview'] = {};
  if (planLines) {
    const p = previewTermMarks({ plan: planLines, scale: ps.scale.scale, assessments: calc, marks: lookup, studentIds: roster.map((s) => s.id) });
    for (const [id, r] of Array.from(p)) preview[id] = shortPreview(r);
  }

  const summary: Grid['summary'] = {};
  const warnings: Grid['warnings'] = {};
  const sd = num(settings.outlierSd) ?? 3;
  for (const c of columns) {
    const cellMarks = roster.map((s) => lookup.get(markKey(s.id, c.assessmentId, c.stageId)));
    const entered = cellMarks.filter((m) => m && (m.value !== null || m.code !== null)).length;
    const asPct = cellMarks.map((m) => (m && m.value !== null ? m.value : null));
    const values = asPct.filter((v): v is number => v !== null);
    const st = classStats(values, (ps.scale.passMark / 100) * c.max);
    summary[c.key] = { entered, expected: roster.length, mean: st.mean, highest: st.highest, lowest: st.lowest, passRate: st.passRate };
    outliers(asPct, sd).forEach((i) => {
      warnings[markKey(roster[i]!.id, c.assessmentId, c.stageId)] = `More than ${sd} standard deviations from the class mean (${st.mean})`;
    });
  }

  const status = (sheet?.status ?? 'NOT_STARTED') as GridSheet['status'];
  return {
    assignmentId: a.id, termId: a.termId, termName: a.term.name, subjectName: a.subject.name, className: classNameOf(a), teacherName: a.teacher.fullName,
    canEdit: mayEdit && a.status === 'ACTIVE' && a.term.status !== 'CLOSED' && EDITABLE.includes(status),
    sheet: {
      id: sheet?.id ?? null, status,
      firstSubmittedAt: sheet?.firstSubmittedAt?.toISOString() ?? null,
      returnedComment: status === 'RETURNED' ? sheet?.returnedComment ?? null : null,
      unlockReason: status === 'UNLOCKED' ? sheet?.unlockReason ?? null : null,
      needsReason: !!sheet?.firstSubmittedAt,
    },
    columns, assessments: calc,
    students: roster.map((s) => ({ id: s.id, name: nameFor(s), admissionNumber: s.admissionNumber, gender: s.gender })),
    marks, comments, plan: planLines, scale: ps.scale.scale, passMark: ps.scale.passMark, outlierSd: sd, commentsEnabled: settings.subjectCommentsEnabled,
    planProblem: planLines ? null : `No weighting plan has been set for this level in ${a.term.name}. Ask the Exams Officer to set one.`,
    preview, summary, warnings,
  };
}

const shortPreview = (r: StudentPreview) => ({ termMark: r.termMark, roundedMark: r.roundedMark, grade: r.grade, incomplete: r.incomplete });

// ─── Saving ──────────────────────────────────────────────────────────────────

const CellSchema = z.object({
  studentId: idSchema,
  assessmentId: idSchema,
  stageId: idSchema.nullish(),
  value: z.number().finite().nullable(),
  code: z.enum(['AB', 'EX', 'NS']).nullable(),
  /** When the teacher typed it (their device clock); the later of two versions wins. */
  changedAt: z.string().datetime({ offset: true }).optional(),
}).refine((c) => c.value === null || c.code === null, { message: 'A cell holds a mark or a code, not both' });

export const SaveMarksSchema = z.object({
  assignmentId: idSchema,
  cells: z.array(CellSchema).min(1, 'There is nothing to save').max(600),
  reason: z.string().trim().max(300).nullish(),
  source: z.enum(['grid', 'import']).default('grid'),
  deviceId: z.string().trim().max(64).optional(),
});
export type SaveMarksInput = z.input<typeof SaveMarksSchema>;
export interface CellInput { studentId: string; assessmentId: string; stageId?: string | null; value: number | null; code: MarkCode | null; changedAt?: string }

export type CellOutcome =
  | { key: string; status: 'saved' | 'unchanged' }
  | { key: string; status: 'rejected'; message: string }
  | { key: string; status: 'stale'; message: string; value: number | null; code: MarkCode | null };

export interface SaveResult {
  saved: number;
  unchanged: number;
  outcomes: CellOutcome[];
  warnings: { key: string; message: string }[];
  sheet: { status: keyof typeof STATUS_LABEL; entered: number; expected: number };
}

interface WriteContext {
  user: Actor;
  a: LoadedAssignment;
  sheet: { id: string; firstSubmittedAt: Date | null };
  reason: string | null;
  /** The Head's correction: may set AB_EXCUSED and may write to a locked sheet. */
  head?: boolean;
  /** The rubric view writes the total of the clicked levels; a rubric stage is never typed directly. */
  fromRubric?: boolean;
}

/**
 * Validates and writes cells. The one function that creates or changes a mark. Returns what happened to each cell.
 * Rejected cells are reported, not thrown: the rest of the batch is still saved.
 */
export async function writeCells(tx: Db, ctx: WriteContext, cells: CellInput[]): Promise<{ outcomes: CellOutcome[]; changed: CellInput[] }> {
  const { user, a } = ctx;
  const sid = user.schoolId;
  const roster = await rosterOf(tx, sid, a);
  const onRoster = new Set(roster.map((s) => s.id));
  const assessments = await assessmentsOf(tx, sid, a);
  const byId = new Map(assessments.map((x) => [x.id, x]));
  const stageIds = Array.from(new Set(cells.map((c) => c.stageId).filter((x): x is string => !!x)));
  const stages = stageIds.length ? await tx.projectStage.findMany({ where: { schoolId: sid, id: { in: stageIds } }, include: { rubric: { select: { id: true } } } }) : [];
  const stageById = new Map(stages.map((s) => [s.id, s]));

  const outcomes = new Map<string, CellOutcome>();
  const valid: CellInput[] = [];
  const seen = new Set<string>();
  for (const c of cells) {
    const key = markKey(c.studentId, c.assessmentId, c.stageId);
    const reject = (message: string) => outcomes.set(key, { key, status: 'rejected', message });
    const asm = byId.get(c.assessmentId);
    if (seen.has(key)) { reject('This cell appears twice in the same save'); continue; }
    seen.add(key);
    if (!asm) { reject('This assessment is not part of this class'); continue; }
    if (!onRoster.has(c.studentId)) { reject('This student does not take the subject in this class'); continue; }
    if (c.code === 'AB_EXCUSED' && !ctx.head) { reject('Only the Head can excuse an absence'); continue; }
    let max = num(asm.maxMark)!;
    if (asm.projectId) {
      const st = c.stageId ? stageById.get(c.stageId) : undefined;
      if (!st || st.templateId !== asm.projectId) { reject('Choose a stage of the project'); continue; }
      if (st.rubric && !ctx.fromRubric) { reject('This stage is marked with a rubric. Click a level for each criterion instead.'); continue; }
      max = num(st.maxMark)!;
    } else if (c.stageId) { reject('This assessment has no stages'); continue; }
    if (c.value !== null) {
      const p = parseCell(String(c.value), max);
      if (!p.ok) { reject(p.message); continue; }
    }
    valid.push(c);
  }

  // What is there now.
  const existing = valid.length
    ? await tx.assessmentMark.findMany({
        where: { schoolId: sid, assignmentId: a.id, assessmentId: { in: Array.from(new Set(valid.map((c) => c.assessmentId))) }, studentId: { in: Array.from(new Set(valid.map((c) => c.studentId))) } },
      })
    : [];
  const current = new Map(existing.map((m) => [markKey(m.studentId, m.assessmentId, m.stageId), m]));

  const changed: CellInput[] = [];
  const inserts: Prisma.AssessmentMarkCreateManyInput[] = [];
  const updates: { id: string; c: CellInput; oldValue: number | null; oldCode: MarkCode | null }[] = [];
  for (const c of valid) {
    const key = markKey(c.studentId, c.assessmentId, c.stageId);
    const at = c.changedAt ? new Date(c.changedAt) : new Date();
    const cur = current.get(key);
    if (cur) {
      if (cur.clientChangedAt && c.changedAt && at < cur.clientChangedAt) {
        outcomes.set(key, { key, status: 'stale', message: 'Someone changed this mark more recently, so yours was not applied', value: num(cur.value), code: cur.code });
        continue;
      }
      if (cur.code === 'AB_EXCUSED' && c.code !== 'AB_EXCUSED' && !ctx.head) {
        outcomes.set(key, { key, status: 'rejected', message: 'The Head excused this absence. Ask the Head to change it.' });
        continue;
      }
      if (num(cur.value) === c.value && cur.code === c.code) { outcomes.set(key, { key, status: 'unchanged' }); continue; }
      updates.push({ id: cur.id, c, oldValue: num(cur.value), oldCode: cur.code });
    } else {
      if (c.value === null && c.code === null) { outcomes.set(key, { key, status: 'unchanged' }); continue; }
      inserts.push({ schoolId: sid, assessmentId: c.assessmentId, assignmentId: a.id, studentId: c.studentId, stageId: c.stageId ?? null, value: c.value, code: c.code, enteredById: user.id, clientChangedAt: at });
    }
    changed.push(c);
  }

  const afterFirstSubmission = !!ctx.sheet.firstSubmittedAt;
  if (changed.length > 0 && afterFirstSubmission && (!ctx.reason || ctx.reason.trim().length < 3)) {
    throw new ServiceError('This mark sheet has been submitted before, so every change needs a reason. Enter the reason for the change.', 422);
  }

  const history: Prisma.AssessmentMarkChangeCreateManyInput[] = [];
  const reason = ctx.reason?.trim() ?? '';

  if (inserts.length) {
    const created = await tx.assessmentMark.createManyAndReturn({ data: inserts, skipDuplicates: true });
    const createdKeys = new Set(created.map((m) => markKey(m.studentId, m.assessmentId, m.stageId)));
    for (const row of created) {
      const key = markKey(row.studentId, row.assessmentId, row.stageId);
      outcomes.set(key, { key, status: 'saved' });
      if (afterFirstSubmission) history.push({ schoolId: sid, markId: row.id, sheetId: ctx.sheet.id, oldValue: null, oldCode: null, newValue: row.value, newCode: row.code, changedById: user.id, reason });
    }
    // Another request created the same cell between our read and our insert: treat it as an update of what is there now.
    for (const ins of inserts) {
      const key = markKey(ins.studentId, ins.assessmentId, ins.stageId as string | null);
      if (createdKeys.has(key)) continue;
      const row = await tx.assessmentMark.findFirst({ where: { schoolId: sid, assessmentId: ins.assessmentId, studentId: ins.studentId, stageId: (ins.stageId as string | null) ?? null } });
      if (!row) continue;
      if (num(row.value) === (ins.value as number | null) && row.code === ins.code) { outcomes.set(key, { key, status: 'unchanged' }); continue; }
      updates.push({ id: row.id, c: { studentId: ins.studentId, assessmentId: ins.assessmentId, stageId: ins.stageId as string | null, value: ins.value as number | null, code: ins.code as CellInput['code'] }, oldValue: num(row.value), oldCode: row.code });
    }
  }

  for (const u of updates) {
    const key = markKey(u.c.studentId, u.c.assessmentId, u.c.stageId);
    await tx.assessmentMark.update({
      where: { id: u.id },
      data: { value: u.c.value, code: u.c.code, enteredById: user.id, clientChangedAt: u.c.changedAt ? new Date(u.c.changedAt) : new Date() },
    });
    outcomes.set(key, { key, status: 'saved' });
    if (afterFirstSubmission) history.push({ schoolId: sid, markId: u.id, sheetId: ctx.sheet.id, oldValue: u.oldValue, oldCode: u.oldCode, newValue: u.c.value, newCode: u.c.code, changedById: user.id, reason });
  }
  if (history.length) await tx.assessmentMarkChange.createMany({ data: history });

  return { outcomes: cells.map((c) => outcomes.get(markKey(c.studentId, c.assessmentId, c.stageId)) ?? { key: markKey(c.studentId, c.assessmentId, c.stageId), status: 'unchanged' as const }), changed };
}

/** Warnings that do not stop a save: a mark far from the class mean, and AB for a student the register shows present that day. */
async function warningsFor(tx: Db, a: LoadedAssignment, saved: CellInput[], sd: number): Promise<{ key: string; message: string }[]> {
  const sid = a.schoolId;
  const out: { key: string; message: string }[] = [];
  const keyOf = (c: CellInput) => markKey(c.studentId, c.assessmentId, c.stageId);

  // Far from the class mean.
  const numeric = saved.filter((c) => c.value !== null);
  for (const group of groupBy(numeric, (c) => `${c.assessmentId}|${c.stageId ?? ''}`)) {
    const [first] = group;
    const all = await tx.assessmentMark.findMany({ where: { schoolId: sid, assignmentId: a.id, assessmentId: first!.assessmentId, stageId: first!.stageId ?? null, value: { not: null } }, select: { studentId: true, value: true } });
    const values = all.map((m) => num(m.value)!);
    const flagged = new Set(outliers(values, sd).map((i) => all[i]!.studentId));
    const st = classStats(values, 0);
    for (const c of group) if (flagged.has(c.studentId)) out.push({ key: keyOf(c), message: `${c.value} is more than ${sd} standard deviations from the class mean (${st.mean}). Check it.` });
  }

  // AB although present in the register.
  const absent = saved.filter((c) => c.code === 'AB');
  if (absent.length) {
    const asm = await tx.assessment.findMany({ where: { schoolId: sid, id: { in: Array.from(new Set(absent.map((c) => c.assessmentId))) }, date: { not: null } }, select: { id: true, date: true } });
    const dateOf = new Map(asm.map((x) => [x.id, x.date!]));
    const entries = await tx.attendanceEntry.findMany({
      where: {
        schoolId: sid, studentId: { in: absent.map((c) => c.studentId) }, status: { in: ['PRESENT', 'LATE'] },
        register: { session: { in: ['AM', 'PM'] }, date: { in: Array.from(new Set(Array.from(dateOf.values()).map((d) => d.getTime()))).map((t) => new Date(t)) } },
      },
      select: { studentId: true, register: { select: { date: true } } },
    });
    const present = new Set(entries.map((e) => `${e.studentId}|${e.register.date.getTime()}`));
    for (const c of absent) {
      const d = dateOf.get(c.assessmentId);
      if (d && present.has(`${c.studentId}|${d.getTime()}`)) out.push({ key: keyOf(c), message: 'Marked absent, but the register shows this student was at school that day' });
    }
  }
  return out;
}

function groupBy<T>(xs: T[], f: (x: T) => string): T[][] {
  const m = new Map<string, T[]>();
  for (const x of xs) (m.get(f(x)) ?? m.set(f(x), []).get(f(x))!).push(x);
  return Array.from(m.values());
}

/** How many students have a mark (or code) in every column of the sheet: the figure behind "38 of 45 entered". */
export async function sheetProgress(tx: Db, schoolId: string, a: LoadedAssignment): Promise<{ entered: number; expected: number }> {
  const [roster, assessments] = await Promise.all([rosterOf(tx, schoolId, a), assessmentsOf(tx, schoolId, a)]);
  const counting = assessments.filter((x) => x.countsToTerm);
  if (counting.length === 0 || roster.length === 0) return { entered: 0, expected: 0 };
  const stages = await tx.projectStage.findMany({ where: { schoolId, templateId: { in: counting.map((x) => x.projectId).filter((x): x is string => !!x) } }, select: { id: true, templateId: true } });
  const cells = counting.flatMap((x) => (x.projectId ? stages.filter((s) => s.templateId === x.projectId).map((s) => ({ aid: x.id, sid: s.id })) : [{ aid: x.id, sid: null as string | null }]));
  const marks = await tx.assessmentMark.findMany({
    where: { schoolId, assignmentId: a.id, assessmentId: { in: counting.map((x) => x.id) }, OR: [{ value: { not: null } }, { code: { not: null } }] },
    select: { studentId: true, assessmentId: true, stageId: true },
  });
  const have = new Set(marks.map((m) => markKey(m.studentId, m.assessmentId, m.stageId)));
  const entered = roster.filter((s) => cells.every((c) => have.has(markKey(s.id, c.aid, c.sid)))).length;
  return { entered, expected: roster.length };
}

/** Saves a batch of cells from the grid, a paste, or a confirmed import. */
export async function saveMarks(user: Actor, raw: unknown): Promise<SaveResult> {
  const input = SaveMarksSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const { a, sheet } = await openForEntry(tx, user, input.assignmentId);
    const { outcomes, changed } = await writeCells(tx, { user, a, sheet, reason: input.reason ?? null }, input.cells as CellInput[]);
    const settings = await loadExamSettings(tx, user.schoolId);
    const warnings = changed.length ? await warningsFor(tx, a, changed, num(settings.outlierSd) ?? 3) : [];
    if (changed.length > 0 && sheet.status === 'NOT_STARTED') await tx.markSheet.update({ where: { id: sheet.id }, data: { status: 'IN_PROGRESS' } });
    const saved = outcomes.filter((o) => o.status === 'saved').length;
    if (saved > 0) {
      const names = await tx.assessment.findMany({ where: { id: { in: Array.from(new Set(changed.map((c) => c.assessmentId))) } }, select: { title: true } });
      await logAudit({
        schoolId: user.schoolId, actorId: user.id, action: sheet.firstSubmittedAt ? 'CORRECT_MARK' : input.source === 'import' ? 'IMPORT_MARKS' : 'ENTER_MARKS',
        entityType: 'MarkSheet', entityId: sheet.id,
        detail: `${saved} mark(s) ${input.source === 'import' ? 'imported' : 'entered'} for ${a.subject.name} ${classNameOf(a)} (${names.map((n) => n.title).join(', ')})${sheet.firstSubmittedAt ? `. Reason: ${input.reason}` : ''}`,
      }, tx);
    }
    const progress = await sheetProgress(tx, user.schoolId, a);
    return {
      saved, unchanged: outcomes.filter((o) => o.status === 'unchanged').length, outcomes, warnings,
      sheet: { status: (changed.length > 0 && sheet.status === 'NOT_STARTED' ? 'IN_PROGRESS' : sheet.status), ...progress },
    };
  }, { timeout: 30_000 });
}

export interface SyncItemResult { ref: string; ok: boolean; message?: string; result?: SaveResult }

/**
 * Marks typed offline arrive together when the signal returns. Each batch is saved on its own; one failing batch does not
 * stop the others, and sending a batch twice changes nothing the second time.
 */
export async function syncMarks(user: Actor, raw: unknown): Promise<SyncItemResult[]> {
  const batches = z.array(z.object({ ref: z.string().min(1).max(120) }).passthrough()).max(40).parse(raw);
  const out: SyncItemResult[] = [];
  for (const b of batches) {
    try {
      out.push({ ref: b.ref, ok: true, result: await saveMarks(user, b) });
    } catch (e) {
      if (e instanceof ServiceError) out.push({ ref: b.ref, ok: false, message: e.message });
      else if (e instanceof z.ZodError) out.push({ ref: b.ref, ok: false, message: e.issues[0]?.message ?? 'Invalid marks' });
      else throw e;
    }
  }
  return out;
}

// ─── The Head's correction: excusing an absence ──────────────────────────────

const ExcuseSchema = z.object({
  assignmentId: idSchema, assessmentId: idSchema, studentId: idSchema, stageId: idSchema.nullish(),
  excused: z.boolean().default(true), reason: z.string().trim().min(3, 'Give a reason').max(300),
});

/**
 * The Head excuses an absence: AB becomes AB_EXCUSED and the assessment is left out of the student's term mark (the other
 * weights are scaled up). Works on a verified sheet, writes a history row, and recalculates the level's results. Not allowed on
 * a published sheet: unpublish the class first.
 */
export async function excuseAbsence(user: Actor, raw: unknown) {
  const input = ExcuseSchema.parse(raw);
  if (!holds(user, 'exams.marks.unlock')) throw new ServiceError('Forbidden', 403);
  const { recalculateLevel } = await import('@/lib/results/service');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await loadAssignment(tx, user.schoolId, input.assignmentId);
    const sheet = await ensureSheet(tx, user.schoolId, a);
    if (sheet.status === 'PUBLISHED') throw new ServiceError('These results are published. Unpublish the class before excusing an absence.', 409);
    if (a.term.status === 'CLOSED') throw new ServiceError(`${a.term.name} is closed`, 409);
    const mark = await tx.assessmentMark.findFirst({ where: { schoolId: user.schoolId, assignmentId: a.id, assessmentId: input.assessmentId, studentId: input.studentId, stageId: input.stageId ?? null } });
    const from: MarkCode = input.excused ? 'AB' : 'AB_EXCUSED';
    const to: MarkCode = input.excused ? 'AB_EXCUSED' : 'AB';
    if (!mark || mark.code !== from) throw new ServiceError(input.excused ? 'Only a mark of AB can be excused' : 'This absence is not excused', 409);
    await tx.$executeRaw`SELECT set_config('app.marks_unlock', '1', true)`;
    await tx.assessmentMark.update({ where: { id: mark.id }, data: { code: to, enteredById: user.id, clientChangedAt: new Date() } });
    await tx.assessmentMarkChange.create({ data: { schoolId: user.schoolId, markId: mark.id, sheetId: sheet.id, oldValue: null, oldCode: from, newValue: null, newCode: to, changedById: user.id, reason: input.reason } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'EXCUSE_ABSENCE', entityType: 'AssessmentMark', entityId: mark.id, detail: `${input.excused ? 'Excused' : 'Withdrew the excuse for'} an absence in ${a.subject.name} ${classNameOf(a)}. Reason: ${input.reason}` }, tx);
    if (sheet.status === 'VERIFIED') await recalculateLevel(tx, user, a.termId, levelIdOf(a));
    return { markId: mark.id, code: to };
  }, { timeout: 30_000 });
}


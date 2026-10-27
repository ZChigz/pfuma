// Mark sheets: one teacher assignment's marks for a term, and the one way they move.
//
//   Not started -> In progress -> Submitted -> Verified -> Published
//                       ^             |            |
//                       +-- Returned -+            +-- Unlocked (the Head, with a reason) -> back through submission
//
// Every move is a named action by a named person (MarkSheetEvent + audit log). A returned sheet goes back to the teacher
// before it is locked. A verified or published sheet can only be opened again by the Head; a published one only after its
// class's results are unpublished. Nobody verifies their own marks, not even an administrator (also a database rule).
import { z } from 'zod';
import type { MarkSheetStatus, SheetAction } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { notifyUsers } from '@/lib/system/notifications';
import { classStats, markKey } from '@/lib/results';
import { recalculateLevel } from '@/lib/results/service';
import { peopleWith } from '@/lib/academics/common';
import {
  EDITABLE, STATUS_LABEL, assertLive, assertOwnAssignment, classNameOf, ensureSheet, holds, idSchema, isTeacherOf, levelIdOf, loadAssignment, num,
  resolveTerm, toDay, todayInHarare, type Actor, type LoadedAssignment,
} from '@/lib/exams/common';
import { buildGrid, type Grid } from '@/lib/exams/marks';

// ─── Who verifies ────────────────────────────────────────────────────────────

export interface VerifierInfo {
  /** The Head of Department of the subject's department, if there is one. */
  hodId: string | null;
  alternateId: string | null;
  /** The HOD teaches this class, so the sheet goes to the alternate verifier. */
  hodIsTeacher: boolean;
  /** The people allowed to verify it (not counting administrators). */
  verifierIds: string[];
}

export async function verifiersOf(tx: Db, schoolId: string, a: LoadedAssignment): Promise<VerifierInfo> {
  const deptId = a.subject.departmentId;
  const dept = deptId ? await tx.department.findFirst({ where: { id: deptId, schoolId }, select: { hodUserId: true } }) : null;
  const alt = deptId ? await tx.examDepartmentVerifier.findUnique({ where: { departmentId: deptId } }) : null;
  const hodId = dept?.hodUserId ?? null;
  const hodIsTeacher = !!hodId && isTeacherOf(a, hodId);
  const ids = hodId && !hodIsTeacher ? [hodId] : alt ? [alt.userId] : [];
  return { hodId, alternateId: alt?.userId ?? null, hodIsTeacher, verifierIds: ids.filter((id) => !isTeacherOf(a, id)) };
}

/** May this person verify (or return) this sheet? Never the teacher or second teacher, whoever they are. */
export function mayVerify(user: Actor, a: LoadedAssignment, v: VerifierInfo): boolean {
  if (isTeacherOf(a, user.id)) return false;
  return holds(user, 'exams.marks.verify') && v.verifierIds.includes(user.id);
}

// ─── Moving a sheet ──────────────────────────────────────────────────────────

async function move(
  tx: Db, user: Actor, sheet: { id: string; status: MarkSheetStatus }, to: MarkSheetStatus, action: SheetAction,
  data: Record<string, unknown>, comment?: string | null,
) {
  await tx.markSheet.update({ where: { id: sheet.id }, data: { status: to, ...data } });
  await tx.markSheetEvent.create({ data: { schoolId: user.schoolId, sheetId: sheet.id, action, fromStatus: sheet.status, toStatus: to, actorId: user.id, comment: comment ?? null } });
}

const linkFor = (assignmentId: string) => `/exams/marks/${assignmentId}`;

export interface MissingMark { studentId: string; student: string; assessment: string }
export interface SubmissionCheck { ready: boolean; problem: string | null; missing: MissingMark[]; missingTotal: number }

/** What blocks submission: no plan, no assessments, or students without a mark, AB, EX or NS. */
export async function checkSubmission(tx: Db, user: Actor, a: LoadedAssignment, grid?: Grid): Promise<SubmissionCheck> {
  const g = grid ?? (await buildGrid(tx, user, a, true));
  if (g.planProblem) return { ready: false, problem: g.planProblem, missing: [], missingTotal: 0 };
  const counting = g.columns.filter((c) => c.countsToTerm);
  if (counting.length === 0) return { ready: false, problem: 'There are no assessments yet. Create at least one that counts towards the term mark.', missing: [], missingTotal: 0 };
  if (g.students.length === 0) return { ready: false, problem: 'No students take this subject in this class. Check the students\' subjects in Academics.', missing: [], missingTotal: 0 };
  const missing: MissingMark[] = [];
  let total = 0;
  for (const s of g.students) {
    for (const c of counting) {
      const m = g.marks[markKey(s.id, c.assessmentId, c.stageId)];
      if (!m || (m.v === null && m.c === null)) {
        total++;
        if (missing.length < 200) missing.push({ studentId: s.id, student: s.name, assessment: c.stageName ? `${c.title}: ${c.stageName}` : c.title });
      }
    }
  }
  return { ready: total === 0, problem: null, missing, missingTotal: total };
}

export async function submissionCheck(user: Actor, assignmentId: string): Promise<SubmissionCheck> {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await loadAssignment(tx, user.schoolId, assignmentId);
    assertOwnAssignment(user, a, 'exams.marks.submit');
    return checkSubmission(tx, user, a);
  });
}

/** The teacher hands the sheet in for verification. Every student needs a mark, AB, EX or NS for every assessment that counts. */
export async function submitSheet(user: Actor, assignmentId: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await loadAssignment(tx, user.schoolId, assignmentId);
    assertOwnAssignment(user, a, 'exams.marks.submit');
    assertLive(a);
    const sheet = await ensureSheet(tx, user.schoolId, a);
    if (!EDITABLE.includes(sheet.status)) throw new ServiceError(`This mark sheet is already ${STATUS_LABEL[sheet.status].toLowerCase()}`, 409);
    const check = await checkSubmission(tx, user, a);
    if (!check.ready) {
      if (check.problem) throw new ServiceError(check.problem, 409);
      const sample = check.missing.slice(0, 5).map((m) => `${m.student} (${m.assessment})`).join(', ');
      throw new ServiceError(`${check.missingTotal} mark(s) are missing: ${sample}${check.missingTotal > 5 ? ' and more' : ''}. Enter a mark, AB, EX or NS for each.`, 409);
    }
    const now = new Date();
    await move(tx, user, sheet, 'SUBMITTED', 'SUBMIT', { submittedAt: now, submittedById: user.id, firstSubmittedAt: sheet.firstSubmittedAt ?? now });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SUBMIT_MARK_SHEET', entityType: 'MarkSheet', entityId: sheet.id, detail: `Submitted ${a.subject.name} ${classNameOf(a)}, ${a.term.name}, for verification` }, tx);
    const v = await verifiersOf(tx, user.schoolId, a);
    const who = v.verifierIds.length ? v.verifierIds : await peopleWith(tx, user.schoolId, 'exams.marks.verify');
    await notifyUsers(tx, user.schoolId, who.filter((id) => !isTeacherOf(a, id) && id !== user.id), {
      type: 'MARKS_SUBMITTED', title: `${a.subject.name} ${classNameOf(a)} is ready to verify`, body: `${a.teacher.fullName} submitted the marks for ${a.term.name}.`, link: `/exams/verify/${a.id}`,
      dedupeKey: `marks-submitted:${sheet.id}:${now.getTime()}`,
    });
    return { status: 'SUBMITTED' as const };
  });
}

/** The HOD (or the alternate verifier) accepts the sheet. It is locked and the results of the level are recalculated. */
export async function verifySheet(user: Actor, assignmentId: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await loadAssignment(tx, user.schoolId, assignmentId);
    const v = await verifiersOf(tx, user.schoolId, a);
    if (isTeacherOf(a, user.id)) throw new ServiceError('You cannot verify your own marks. They go to the alternate verifier.', 403);
    if (!mayVerify(user, a, v)) throw new ServiceError('Class not found', 404);
    const sheet = await ensureSheet(tx, user.schoolId, a);
    if (sheet.status !== 'SUBMITTED') throw new ServiceError(`Only a submitted mark sheet can be verified (this one is ${STATUS_LABEL[sheet.status].toLowerCase()})`, 409);
    if (sheet.submittedById === user.id) throw new ServiceError('You submitted this mark sheet, so someone else must verify it', 403);
    const check = await checkSubmission(tx, user, a);
    if (check.problem) throw new ServiceError(check.problem, 409);
    await move(tx, user, sheet, 'VERIFIED', 'VERIFY', { verifiedById: user.id, verifiedAt: new Date() });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'VERIFY_MARK_SHEET', entityType: 'MarkSheet', entityId: sheet.id, detail: `Verified ${a.subject.name} ${classNameOf(a)}, ${a.term.name}` }, tx);
    const summary = await recalculateLevel(tx, user, a.termId, levelIdOf(a));
    await notifyUsers(tx, user.schoolId, [a.teacherId, ...(a.coTeacherId ? [a.coTeacherId] : [])], {
      type: 'MARKS_VERIFIED', title: `${a.subject.name} ${classNameOf(a)} was verified`, body: `${user.fullName ?? 'The verifier'} verified your marks for ${a.term.name}.`, link: linkFor(a.id), dedupeKey: `marks-verified:${sheet.id}:${Date.now()}`,
    });
    return { status: 'VERIFIED' as const, calculated: summary.subjectResults };
  }, { timeout: 60_000 });
}

const ReturnSchema = z.object({ comment: z.string().trim().min(3, 'Write what the teacher needs to fix').max(500) });

/** The verifier sends the sheet back to the teacher with a comment. The teacher is told. */
export async function returnSheet(user: Actor, assignmentId: string, raw: unknown) {
  const input = ReturnSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await loadAssignment(tx, user.schoolId, assignmentId);
    const v = await verifiersOf(tx, user.schoolId, a);
    if (!mayVerify(user, a, v)) throw new ServiceError('Class not found', 404);
    const sheet = await ensureSheet(tx, user.schoolId, a);
    if (sheet.status !== 'SUBMITTED') throw new ServiceError(`Only a submitted mark sheet can be returned (this one is ${STATUS_LABEL[sheet.status].toLowerCase()})`, 409);
    await move(tx, user, sheet, 'RETURNED', 'RETURN', { returnedComment: input.comment, returnedById: user.id, returnedAt: new Date() }, input.comment);
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'RETURN_MARK_SHEET', entityType: 'MarkSheet', entityId: sheet.id, detail: `Returned ${a.subject.name} ${classNameOf(a)} to the teacher: ${input.comment}` }, tx);
    await notifyUsers(tx, user.schoolId, [a.teacherId, ...(a.coTeacherId ? [a.coTeacherId] : [])], {
      type: 'MARKS_RETURNED', title: `${a.subject.name} ${classNameOf(a)} was returned`, body: input.comment, link: linkFor(a.id), dedupeKey: `marks-returned:${sheet.id}:${Date.now()}`,
    });
    return { status: 'RETURNED' as const };
  });
}

const UnlockSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500) });

/**
 * The Head opens a verified sheet again, with a reason. It goes back to the teacher and then through submission and
 * verification again. A published sheet must first have its class's results unpublished.
 */
export async function unlockSheet(user: Actor, assignmentId: string, raw: unknown) {
  const input = UnlockSchema.parse(raw);
  if (!holds(user, 'exams.marks.unlock')) throw new ServiceError('Forbidden', 403);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await loadAssignment(tx, user.schoolId, assignmentId);
    if (a.term.status === 'CLOSED') throw new ServiceError(`${a.term.name} is closed`, 409);
    const sheet = await ensureSheet(tx, user.schoolId, a);
    if (sheet.status === 'PUBLISHED') throw new ServiceError('These results are published. Unpublish the class first (with a reason), then unlock the sheet.', 409);
    if (sheet.status !== 'VERIFIED') throw new ServiceError(`Only a verified mark sheet needs unlocking (this one is ${STATUS_LABEL[sheet.status].toLowerCase()})`, 409);
    if (await tx.subjectResult.count({ where: { schoolId: user.schoolId, assignmentId: a.id, termId: a.termId, published: true } })) {
      throw new ServiceError('Some results from this sheet are published. Unpublish those classes first.', 409);
    }
    await move(tx, user, sheet, 'UNLOCKED', 'UNLOCK', { unlockedById: user.id, unlockedAt: new Date(), unlockReason: input.reason }, input.reason);
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'UNLOCK_MARK_SHEET', entityType: 'MarkSheet', entityId: sheet.id, detail: `Unlocked ${a.subject.name} ${classNameOf(a)}, ${a.term.name}. Reason: ${input.reason}` }, tx);
    await recalculateLevel(tx, user, a.termId, levelIdOf(a));
    await notifyUsers(tx, user.schoolId, [a.teacherId, ...(a.coTeacherId ? [a.coTeacherId] : [])], {
      type: 'MARKS_UNLOCKED', title: `${a.subject.name} ${classNameOf(a)} was opened for correction`, body: input.reason, link: linkFor(a.id), dedupeKey: `marks-unlocked:${sheet.id}:${Date.now()}`,
    });
    return { status: 'UNLOCKED' as const };
  }, { timeout: 60_000 });
}

// ─── The teacher's list ──────────────────────────────────────────────────────

export interface MySheetItem {
  assignmentId: string;
  subject: string;
  className: string;
  teacher: string;
  status: MarkSheetStatus;
  statusLabel: string;
  students: number;
  assessments: { id: string; title: string; entered: number; expected: number; max: number }[];
  progressText: string;
  entryOverdue: boolean;
  submitOverdue: boolean;
  returnedComment: string | null;
}

export interface MySheets { termId: string; termName: string; deadlines: { entryDue: string | null; submitDue: string | null; verifyDue: string | null }; items: MySheetItem[] }

const dayText = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** "My marks": the teacher's assignments with each assessment's progress ("Form 2 East Maths, Algebra test 2: 38 of 45 entered") and status. */
export async function mySheets(user: Actor, opts: { termId?: string; all?: boolean } = {}): Promise<MySheets> {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, opts.termId);
    const wide = opts.all && (holds(user, 'exams.marks.view'));
    const assignments = await tx.teacherAssignment.findMany({
      where: { schoolId: user.schoolId, termId: term.id, status: 'ACTIVE', ...(wide ? {} : { OR: [{ teacherId: user.id }, { coTeacherId: user.id }] }) },
      select: { id: true }, orderBy: [{ class: { name: 'asc' } }, { subject: { name: 'asc' } }], take: 300,
    });
    const dl = await tx.examDeadline.findUnique({ where: { termId: term.id } });
    const today = toDay(todayInHarare());
    const items: MySheetItem[] = [];
    for (const { id } of assignments) {
      const a = await loadAssignment(tx, user.schoolId, id);
      const grid = await buildGrid(tx, user, a, false);
      const status = grid.sheet.status;
      const byAssessment = new Map<string, { id: string; title: string; entered: number; expected: number; max: number }>();
      for (const c of grid.columns) {
        const s = grid.summary[c.key]!;
        const cur = byAssessment.get(c.assessmentId);
        // A project shows its least complete stage.
        if (!cur || s.entered < cur.entered) byAssessment.set(c.assessmentId, { id: c.assessmentId, title: c.title, entered: s.entered, expected: s.expected, max: c.max });
      }
      const assessments = Array.from(byAssessment.values());
      const open = EDITABLE.includes(status);
      items.push({
        assignmentId: id, subject: a.subject.name, className: classNameOf(a), teacher: a.teacher.fullName, status, statusLabel: STATUS_LABEL[status], students: grid.students.length, assessments,
        progressText: assessments.length ? assessments.map((x) => `${x.title}: ${x.entered} of ${x.expected} entered`).join('; ') : 'No assessments yet',
        entryOverdue: open && !!dl?.entryDue && dl.entryDue < today && assessments.some((x) => x.entered < x.expected),
        submitOverdue: open && !!dl?.submitDue && dl.submitDue < today,
        returnedComment: grid.sheet.returnedComment,
      });
    }
    return { termId: term.id, termName: term.name, deadlines: { entryDue: dayText(dl?.entryDue), submitDue: dayText(dl?.submitDue), verifyDue: dayText(dl?.verifyDue) }, items };
  });
}

// ─── The verifier's queue and review ─────────────────────────────────────────

export interface QueueItem { assignmentId: string; subject: string; className: string; teacher: string; submittedAt: string | null; department: string | null; verifyOverdue: boolean }

/** Submitted mark sheets the person may verify: their department's (the alternate verifier's: the departments they cover). Administrators see all. */
export async function verificationQueue(user: Actor, termId?: string): Promise<{ termName: string; items: QueueItem[] }> {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const sheets = await tx.markSheet.findMany({
      where: { schoolId: user.schoolId, termId: term.id, status: 'SUBMITTED' },
      include: { assignment: { select: { id: true } } }, orderBy: { submittedAt: 'asc' },
    });
    const dl = await tx.examDeadline.findUnique({ where: { termId: term.id } });
    const today = toDay(todayInHarare());
    const items: QueueItem[] = [];
    for (const s of sheets) {
      const a = await loadAssignment(tx, user.schoolId, s.assignmentId);
      const v = await verifiersOf(tx, user.schoolId, a);
      if (!mayVerify(user, a, v)) continue;
      const dept = a.subject.departmentId ? await tx.department.findFirst({ where: { id: a.subject.departmentId }, select: { name: true } }) : null;
      items.push({
        assignmentId: a.id, subject: a.subject.name, className: classNameOf(a), teacher: a.teacher.fullName, submittedAt: s.submittedAt?.toISOString() ?? null,
        department: dept?.name ?? null, verifyOverdue: !!dl?.verifyDue && dl.verifyDue < today,
      });
    }
    return { termName: term.name, items };
  });
}

export interface SiblingStats { assignmentId: string; className: string; teacher: string; status: MarkSheetStatus; students: number; mean: number | null; passRate: number | null; differenceFromForm: number | null; current: boolean }

export interface Review {
  grid: Grid;
  mayVerify: boolean;
  verifier: VerifierInfo & { names: string[] };
  stats: { count: number; mean: number | null; highest: number | null; lowest: number | null; passRate: number | null };
  gradeSpread: { grade: string; count: number }[];
  siblings: SiblingStats[];
  flagged: { studentId: string; student: string; assessment: string; value: number; message: string }[];
  history: HistoryRow[];
  events: { action: SheetAction; from: MarkSheetStatus; to: MarkSheetStatus; by: string; at: string; comment: string | null }[];
}

export interface HistoryRow { at: string; student: string; assessment: string; from: string; to: string; by: string; reason: string }

const show = (v: number | null, c: string | null) => (v !== null ? String(v) : c ?? 'blank');

async function historyOf(tx: Db, schoolId: string, where: { sheetId?: string; studentId?: string; termId?: string }): Promise<HistoryRow[]> {
  const rows = await tx.assessmentMarkChange.findMany({
    where: { schoolId, ...(where.sheetId ? { sheetId: where.sheetId } : {}), mark: { ...(where.studentId ? { studentId: where.studentId } : {}), ...(where.termId ? { assessment: { termId: where.termId } } : {}) } },
    include: { mark: { select: { studentId: true, stageId: true, assessment: { select: { title: true } }, student: { select: { firstName: true, surname: true } } } } },
    orderBy: { createdAt: 'desc' }, take: 500,
  });
  const people = await tx.user.findMany({ where: { id: { in: Array.from(new Set(rows.map((r) => r.changedById))) } }, select: { id: true, fullName: true } });
  const nameOf = new Map(people.map((p) => [p.id, p.fullName]));
  return rows.map((r) => ({
    at: r.createdAt.toISOString(), student: `${r.mark.student.surname.toUpperCase()}, ${r.mark.student.firstName}`, assessment: r.mark.assessment.title,
    from: show(num(r.oldValue), r.oldCode), to: show(num(r.newValue), r.newCode), by: nameOf.get(r.changedById) ?? 'Unknown', reason: r.reason,
  }));
}

/**
 * The verification screen: the marks, the class mean and pass rate next to the other classes of the same subject, the grade
 * spread, flagged outliers and the history of changes.
 */
export async function reviewSheet(user: Actor, assignmentId: string): Promise<Review> {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await loadAssignment(tx, user.schoolId, assignmentId);
    const v = await verifiersOf(tx, user.schoolId, a);
    const may = mayVerify(user, a, v);
    const own = isTeacherOf(a, user.id) && holds(user, 'exams.marks.enter');
    if (!may && !own && !holds(user, 'exams.marks.view') && !holds(user, 'exams.marks.unlock')) throw new ServiceError('Class not found', 404);
    const grid = await buildGrid(tx, user, a, false);
    const marks = grid.students.map((s) => grid.preview[s.id]).filter((p): p is NonNullable<typeof p> => !!p && p.roundedMark !== null);
    const values = marks.map((m) => m.roundedMark!);
    const stats = classStats(values, grid.passMark);
    const order = grid.scale.map((b) => b.letterGrade);
    const spread = order.map((grade) => ({ grade, count: marks.filter((m) => m.grade === grade).length }));

    // The other classes of the same subject at the same level and term.
    const sibs = await tx.teacherAssignment.findMany({
      where: { schoolId: user.schoolId, termId: a.termId, subjectId: a.subjectId, status: 'ACTIVE', OR: [{ class: { levelId: levelIdOf(a) } }, { group: { levelId: levelIdOf(a) } }] },
      select: { id: true },
    });
    const siblings: SiblingStats[] = [];
    for (const { id } of sibs) {
      const sa = id === a.id ? a : await loadAssignment(tx, user.schoolId, id);
      const sg = id === a.id ? grid : await buildGrid(tx, user, sa, false);
      const vals = sg.students.map((s) => sg.preview[s.id]?.roundedMark).filter((x): x is number => x !== null && x !== undefined);
      const st = classStats(vals, sg.passMark);
      siblings.push({ assignmentId: id, className: classNameOf(sa), teacher: sa.teacher.fullName, status: sg.sheet.status, students: sg.students.length, mean: st.mean, passRate: st.passRate, differenceFromForm: null, current: id === a.id });
    }
    const formVals = siblings.flatMap((s) => (s.mean !== null ? [s.mean * s.students] : []));
    const formN = siblings.reduce((n, s) => n + (s.mean !== null ? s.students : 0), 0);
    const formMean = formN ? formVals.reduce((x, y) => x + y, 0) / formN : null;
    for (const s of siblings) s.differenceFromForm = s.mean !== null && formMean !== null ? Math.round((s.mean - formMean) * 100) / 100 : null;

    const flagged = Object.entries(grid.warnings).map(([key, message]) => {
      const [studentId, assessmentId, stageId] = key.split('|');
      const s = grid.students.find((x) => x.id === studentId)!;
      const col = grid.columns.find((c) => c.assessmentId === assessmentId && (c.stageId ?? '') === (stageId ?? ''))!;
      return { studentId: studentId!, student: s.name, assessment: col.stageName ? `${col.title}: ${col.stageName}` : col.title, value: grid.marks[key]?.v ?? 0, message };
    });

    const sheet = grid.sheet.id ? await tx.markSheet.findUnique({ where: { id: grid.sheet.id }, include: { events: { orderBy: { createdAt: 'asc' } } } }) : null;
    const actorIds = Array.from(new Set([...(sheet?.events.map((e) => e.actorId) ?? []), ...v.verifierIds]));
    const people = await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } });
    const nameOf = new Map(people.map((p) => [p.id, p.fullName]));
    return {
      grid, mayVerify: may && sheet?.status === 'SUBMITTED',
      verifier: { ...v, names: v.verifierIds.map((id) => nameOf.get(id) ?? '') },
      stats, gradeSpread: spread, siblings, flagged,
      history: grid.sheet.id ? await historyOf(tx, user.schoolId, { sheetId: grid.sheet.id }) : [],
      events: (sheet?.events ?? []).map((e) => ({ action: e.action, from: e.fromStatus, to: e.toStatus, by: nameOf.get(e.actorId) ?? 'Unknown', at: e.createdAt.toISOString(), comment: e.comment })),
    };
  });
}

/** Every change to a student's marks this term after first submission, for the student's results page. */
export async function studentMarkHistory(user: Actor, studentId: string, termId?: string): Promise<HistoryRow[]> {
  if (!holds(user, 'exams.results.view')) throw new ServiceError('Forbidden', 403);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    if (!(await tx.student.findFirst({ where: { id: studentId, schoolId: user.schoolId }, select: { id: true } }))) throw new ServiceError('Student not found', 404);
    return historyOf(tx, user.schoolId, { studentId, termId: term.id });
  });
}

// ─── The Head's dashboard ────────────────────────────────────────────────────

export interface TermProgress {
  termId: string;
  termName: string;
  total: number;
  byStatus: Record<MarkSheetStatus, number>;
  verified: number;
  progressText: string;
  overdue: { teacherId: string; teacher: string; sheets: { assignmentId: string; label: string; status: MarkSheetStatus; late: 'entry' | 'submission' | 'verification' }[] }[];
  deadlines: { entryDue: string | null; submitDue: string | null; verifyDue: string | null };
}

/** "34 of 48 mark sheets verified" and the overdue sheets by teacher. */
export async function termProgress(user: Actor, termId?: string): Promise<TermProgress> {
  if (!holds(user, 'exams.marks.view') && !holds(user, 'exams.marks.unlock')) throw new ServiceError('Forbidden', 403);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const [assignments, sheets, dl] = await Promise.all([
      tx.teacherAssignment.findMany({
        where: { schoolId: user.schoolId, termId: term.id, status: 'ACTIVE' },
        select: { id: true, teacherId: true, teacher: { select: { fullName: true } }, subject: { select: { name: true } }, class: { select: { name: true } }, group: { select: { name: true } } },
      }),
      tx.markSheet.findMany({ where: { schoolId: user.schoolId, termId: term.id }, select: { assignmentId: true, status: true } }),
      tx.examDeadline.findUnique({ where: { termId: term.id } }),
    ]);
    const statusOf = new Map(sheets.map((s) => [s.assignmentId, s.status]));
    const byStatus = { NOT_STARTED: 0, IN_PROGRESS: 0, SUBMITTED: 0, VERIFIED: 0, PUBLISHED: 0, RETURNED: 0, UNLOCKED: 0 } as Record<MarkSheetStatus, number>;
    const today = toDay(todayInHarare());
    const overdue = new Map<string, TermProgress['overdue'][number]>();
    for (const a of assignments) {
      const status = statusOf.get(a.id) ?? 'NOT_STARTED';
      byStatus[status]++;
      let late: 'entry' | 'submission' | 'verification' | null = null;
      if (EDITABLE.includes(status)) {
        if (dl?.submitDue && dl.submitDue < today) late = 'submission';
        else if (dl?.entryDue && dl.entryDue < today && (status === 'NOT_STARTED')) late = 'entry';
      } else if (status === 'SUBMITTED' && dl?.verifyDue && dl.verifyDue < today) late = 'verification';
      if (late) {
        const row = overdue.get(a.teacherId) ?? overdue.set(a.teacherId, { teacherId: a.teacherId, teacher: a.teacher.fullName, sheets: [] }).get(a.teacherId)!;
        row.sheets.push({ assignmentId: a.id, label: `${a.subject.name} ${a.class?.name ?? a.group?.name ?? ''}`, status, late });
      }
    }
    const verified = byStatus.VERIFIED + byStatus.PUBLISHED;
    return {
      termId: term.id, termName: term.name, total: assignments.length, byStatus, verified, progressText: `${verified} of ${assignments.length} mark sheets verified`,
      overdue: Array.from(overdue.values()).sort((x, y) => y.sheets.length - x.sheets.length),
      deadlines: { entryDue: dayText(dl?.entryDue), submitDue: dayText(dl?.submitDue), verifyDue: dayText(dl?.verifyDue) },
    };
  });
}

const RemindSchema = z.object({ termId: idSchema.optional(), teacherIds: z.array(idSchema).min(1).max(200), message: z.string().trim().max(300).optional() });

/** The Remind button: tells each teacher which of their mark sheets are overdue. */
export async function remindTeachers(user: Actor, raw: unknown) {
  if (!holds(user, 'exams.marks.unlock') && !holds(user, 'exams.setup.manage')) throw new ServiceError('Forbidden', 403);
  const input = RemindSchema.parse(raw);
  const progress = await termProgress(user, input.termId);
  const wanted = new Set(input.teacherIds);
  const targets = progress.overdue.filter((o) => wanted.has(o.teacherId));
  if (targets.length === 0) throw new ServiceError('None of those teachers has an overdue mark sheet', 409);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const day = todayInHarare();
    let sent = 0;
    for (const t of targets) {
      sent += await notifyUsers(tx, user.schoolId, [t.teacherId], {
        type: 'MARKS_REMINDER', title: `${t.sheets.length} mark sheet(s) are overdue`, body: input.message ?? t.sheets.map((s) => s.label).join(', '),
        link: '/exams/marks', dedupeKey: `marks-reminder:${progress.termId}:${day}`,
      });
    }
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'REMIND_MARK_SHEETS', entityType: 'AcademicTerm', entityId: progress.termId, detail: `Reminded ${targets.length} teacher(s) about overdue mark sheets` }, tx);
    return { reminded: targets.length, sent };
  });
}


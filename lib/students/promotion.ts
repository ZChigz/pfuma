// The year-end promotion wizard. After Term 3 closes, every student at the school gets a decision for the new year:
//   1. choose the new year (it and its Term 1 must exist);
//   2. proposed moves: each student goes to the next form, same stream (Form 2 East → Form 3 East); Form 4 completes
//      O Level, Upper 6 completes A Level, Lower 6 moves up to Upper 6;
//   3. exceptions: repeat, another stream, continue to Lower 6, another class, or leave;
//   4. review: the size of each new class against its capacity, and who is leaving;
//   5. confirm (needs students.promotion.approve): ONE transaction creates the Term 1 enrollments, ends the Term 3 ones,
//      sets the status of leavers, and writes an audit entry per student plus a summary entry.
// It can be saved as a draft and finished later; nothing changes until it is confirmed. A year is confirmed once.
import type { AuditAction, EnrollmentStatus, ExitReason, Prisma } from '@prisma/client';
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { can, type AccessUser } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { suspendStudentMembers } from '@/lib/library';
import { notifyUsers } from '@/lib/system/notifications';
import { idSchema, noteSchema } from '@/lib/students/common';
import {
  completionReason, defaultOutcome, lineProblem, LEAVE_REASONS, OUTCOMES, proposedClassName, reviewLines,
  type Outcome, type PromotionClass, type PromotionLine, type PromotionReview,
} from '@/lib/students/promotion-rules';
import { statusForExit } from '@/lib/students/rules';
import { findOrCreateClass } from '@/lib/students/server';

type Actor = AccessUser & { fullName?: string };

// ─── The decision a person makes for one student ─────────────────────────────

export const DecisionSchema = z.object({
  studentId: idSchema,
  outcome: z.enum(OUTCOMES),
  toClassId: idSchema.nullable().optional(),
  exitReason: z.enum(LEAVE_REASONS).nullable().optional(),
  note: noteSchema(200),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const SaveDraftSchema = z.object({
  fromYearId: idSchema,
  /** Only the decisions that differ from the proposal need to be sent; everyone else keeps the proposal. */
  decisions: z.array(DecisionSchema).max(5000),
});

// ─── Loading the state of the wizard ─────────────────────────────────────────

interface Context {
  fromYear: { id: string; year: number };
  toYear: { id: string; year: number } | null;
  term3: { id: string; name: string; status: string; endDate: Date };
  term1: { id: string; name: string; status: string; startDate: Date } | null;
  problems: string[];
  classes: Map<string, PromotionClass>;
  eligible: { studentId: string; fullName: string; admissionNumber: string; enrollmentId: string; classId: string; className: string; level: number; stream: string }[];
}

async function loadContext(tx: Db, schoolId: string, fromYearId?: string): Promise<Context | null> {
  const years = await tx.academicYear.findMany({ where: { schoolId }, orderBy: { year: 'desc' }, include: { terms: true } });
  const confirmed = new Set((await tx.promotionRun.findMany({ where: { status: 'CONFIRMED' }, select: { fromYearId: true } })).map((r) => r.fromYearId));
  const from = fromYearId
    ? years.find((y) => y.id === fromYearId)
    : years.find((y) => !confirmed.has(y.id) && y.terms.some((t) => t.termNumber === 3 && t.status === 'CLOSED'));
  if (fromYearId && !from) throw new ServiceError('Academic year not found', 404);
  if (!from) return null;
  const term3 = from.terms.find((t) => t.termNumber === 3);
  if (!term3) throw new ServiceError(`${from.year} has no Term 3`, 409);
  const to = years.find((y) => y.year === from.year + 1) ?? null;
  const term1 = to?.terms.find((t) => t.termNumber === 1) ?? null;

  const problems: string[] = [];
  if (term3.status !== 'CLOSED') problems.push(`${term3.name} is not closed yet. Close it first.`);
  if (confirmed.has(from.id)) problems.push(`The ${from.year} promotion has already been confirmed.`);
  if (!to) problems.push(`The ${from.year + 1} academic year does not exist yet. Create it under System, Settings, Academic years.`);
  else if (!term1) problems.push(`The ${to.year} academic year has no Term 1.`);

  const classRows = await tx.schoolClass.findMany({ where: { schoolId }, include: { level: { select: { order: true, active: true } } } });
  const classes = new Map(classRows.map((c) => [c.id, { id: c.id, name: c.name, levelOrder: c.level.order, stream: c.stream, capacity: c.capacity, active: c.active && c.level.active }]));
  const enrollments = await tx.enrollment.findMany({
    where: { termId: term3.id, status: 'ACTIVE', student: { status: { in: ['ACTIVE', 'SUSPENDED'] } } },
    include: { student: { select: { id: true, fullName: true, admissionNumber: true } }, class: { select: { id: true, name: true, stream: true, level: { select: { order: true } } } } },
    orderBy: [{ class: { level: { order: 'asc' } } }, { class: { stream: 'asc' } }, { student: { surname: 'asc' } }, { student: { firstName: 'asc' } }],
  });
  return {
    fromYear: { id: from.id, year: from.year }, toYear: to ? { id: to.id, year: to.year } : null,
    term3: { id: term3.id, name: term3.name, status: term3.status, endDate: term3.endDate },
    term1: term1 ? { id: term1.id, name: term1.name, status: term1.status, startDate: term1.startDate } : null,
    problems, classes,
    eligible: enrollments.map((e) => ({
      studentId: e.student.id, fullName: e.student.fullName, admissionNumber: e.student.admissionNumber, enrollmentId: e.id, classId: e.class.id, className: e.class.name,
      level: e.class.level.order, stream: e.class.stream,
    })),
  };
}

function findClass(classes: Map<string, PromotionClass>, level: number, stream: string) {
  return Array.from(classes.values()).find((c) => c.levelOrder === level && c.stream.toLowerCase() === stream.toLowerCase() && c.active) ?? null;
}

/** The line for one student: the proposal, or the decision someone made. */
function buildLine(e: Context['eligible'][number], classes: Map<string, PromotionClass>, d?: Decision): PromotionLine {
  const base = { studentId: e.studentId, fullName: e.fullName, admissionNumber: e.admissionNumber, fromClassId: e.classId, fromClassName: e.className, fromLevel: e.level, fromStream: e.stream };
  const outcome: Outcome = d?.outcome ?? defaultOutcome(e.level);
  const note = d?.note ?? null;
  if (outcome === 'COMPLETE') return { ...base, outcome, toClassId: null, toClassName: null, exitReason: completionReason(e.level), note };
  if (outcome === 'LEAVE') return { ...base, outcome, toClassId: null, toClassName: null, exitReason: (d?.exitReason ?? null) as ExitReason | null, note };
  if (outcome === 'REPEAT') return { ...base, outcome, toClassId: e.classId, toClassName: e.className, exitReason: null, note };
  if (outcome === 'MOVE_STREAM' || outcome === 'OTHER_CLASS') {
    const k = d?.toClassId ? classes.get(d.toClassId) : undefined;
    return { ...base, outcome, toClassId: k?.id ?? d?.toClassId ?? null, toClassName: k?.name ?? null, exitReason: null, note };
  }
  // PROMOTE and CONTINUE_LOWER_6: the chosen class, or the same stream in the next form (made on confirmation if missing).
  const level = outcome === 'CONTINUE_LOWER_6' ? 5 : e.level + 1;
  const k = d?.toClassId ? classes.get(d.toClassId) : findClass(classes, level, e.stream);
  return { ...base, outcome, toClassId: k?.id ?? null, toClassName: k?.name ?? proposedClassName(level - 1, e.stream), exitReason: null, note };
}

export interface PromotionState {
  fromYear: { id: string; year: number };
  toYear: { id: string; year: number } | null;
  term3: { name: string; status: string };
  term1: { name: string; status: string } | null;
  problems: string[];
  /** A draft exists; the decisions in it are applied on top of the proposal. */
  draft: { id: string; updatedAt: string; decisions: number } | null;
  lines: PromotionLine[];
  review: PromotionReview;
  classes: { id: string; name: string; levelOrder: number; stream: string; capacity: number }[];
  /** Students who joined or left since the draft was saved. */
  changedSinceDraft: number;
  confirmed: { at: string; approvedBy: string } | null;
}

/** Steps 1 to 4 in one call: the proposal for every student, with the draft's decisions applied, and the review. */
export async function promotionState(user: AccessUser, fromYearId?: string): Promise<PromotionState | null> {
  const db = getScopedDb(user.schoolId, user.id);
  const ctx = await loadContext(db, user.schoolId, fromYearId);
  if (!ctx) return null;
  const draft = await db.promotionRun.findFirst({ where: { fromYearId: ctx.fromYear.id, status: 'DRAFT' } });
  const confirmed = await db.promotionRun.findFirst({ where: { fromYearId: ctx.fromYear.id, status: 'CONFIRMED' } });
  const decisions = new Map(((draft?.lines as unknown as Decision[] | null) ?? []).map((d) => [d.studentId, d]));
  const lines = ctx.eligible.map((e) => buildLine(e, ctx.classes, decisions.get(e.studentId)));
  const eligibleIds = new Set(ctx.eligible.map((e) => e.studentId));
  const changed = Array.from(decisions.keys()).filter((id) => !eligibleIds.has(id)).length;
  let approver = '';
  if (confirmed?.approvedById) approver = (await db.user.findFirst({ where: { id: confirmed.approvedById }, select: { fullName: true } }))?.fullName ?? '';
  return {
    fromYear: ctx.fromYear, toYear: ctx.toYear, term3: { name: ctx.term3.name, status: ctx.term3.status }, term1: ctx.term1 ? { name: ctx.term1.name, status: ctx.term1.status } : null,
    problems: ctx.problems, draft: draft ? { id: draft.id, updatedAt: draft.updatedAt.toISOString(), decisions: decisions.size } : null, lines,
    review: reviewLines(lines, ctx.classes), changedSinceDraft: changed,
    classes: Array.from(ctx.classes.values()).filter((c) => c.active).map(({ id, name, levelOrder, stream, capacity }) => ({ id, name, levelOrder, stream, capacity })),
    confirmed: confirmed ? { at: confirmed.confirmedAt?.toISOString() ?? '', approvedBy: approver } : null,
  };
}

// ─── Save a draft ────────────────────────────────────────────────────────────

/** Saves the decisions that differ from the proposal. Every decision is checked; nothing about any student changes. */
export async function savePromotionDraft(user: Actor, rawInput: z.input<typeof SaveDraftSchema>) {
  const input = SaveDraftSchema.parse(rawInput);
  const { schoolId } = user;
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const ctx = await loadContext(tx, schoolId, input.fromYearId);
    if (!ctx) throw new ServiceError('Academic year not found', 404);
    if (ctx.problems.some((p) => p.includes('already been confirmed'))) throw new ServiceError(`The ${ctx.fromYear.year} promotion has already been confirmed`, 409);
    const byStudent = new Map(ctx.eligible.map((e) => [e.studentId, e]));
    const seen = new Set<string>();
    const problems: string[] = [];
    const kept: Decision[] = [];
    for (const d of input.decisions) {
      const e = byStudent.get(d.studentId);
      if (!e) { problems.push('A decision names a student who is not part of this promotion'); continue; }
      if (seen.has(d.studentId)) { problems.push(`${e.fullName} appears twice`); continue; }
      seen.add(d.studentId);
      const problem = lineProblem(buildLine(e, ctx.classes, d), ctx.classes);
      if (problem) problems.push(problem);
      else if (d.outcome !== defaultOutcome(e.level) || d.toClassId || d.note) kept.push({ studentId: d.studentId, outcome: d.outcome, toClassId: d.toClassId ?? null, exitReason: d.exitReason ?? null, note: d.note });
    }
    if (problems.length) throw new ServiceError(`${problems.slice(0, 5).join('. ')}${problems.length > 5 ? ` (and ${problems.length - 5} more)` : ''}`, 422);

    if (!ctx.toYear) throw new ServiceError(ctx.problems.find((x) => x.includes('does not exist')) ?? 'The new academic year does not exist yet', 409);
    const lines = kept as unknown as Prisma.InputJsonValue;
    const existing = await tx.promotionRun.findFirst({ where: { fromYearId: ctx.fromYear.id, status: 'DRAFT' } });
    const run = existing
      ? await tx.promotionRun.update({ where: { id: existing.id }, data: { lines, toYearId: ctx.toYear.id } })
      : await tx.promotionRun.create({ data: { schoolId, fromYearId: ctx.fromYear.id, toYearId: ctx.toYear.id, status: 'DRAFT', lines, createdById: user.id } });
    await logAudit(
      { schoolId, actorId: user.id, action: 'SAVE_PROMOTION_DRAFT', entityType: 'PromotionRun', entityId: run.id, detail: `${ctx.fromYear.year} promotion draft: ${kept.length} decision(s) differ from the proposal`, after: { decisions: kept.length } },
      tx,
    );
    return { id: run.id, decisions: kept.length };
  });
}

// ─── Confirm ─────────────────────────────────────────────────────────────────

export const ConfirmSchema = z.object({ acknowledgeFull: z.boolean().default(false) });

const ENROLLMENT_END: Record<string, EnrollmentStatus> = { TRANSFER: 'TRANSFERRED_OUT', COMPLETED_O_LEVEL: 'GRADUATED', COMPLETED_A_LEVEL: 'GRADUATED' };

/**
 * Applies the promotion: Head approval (students.promotion.approve), then one transaction creates the Term 1
 * enrollments, ends the Term 3 ones, sets the status of leavers and writes one audit entry per student plus a summary.
 */
export async function confirmPromotion(user: Actor, runId: string, rawInput: z.input<typeof ConfirmSchema> = {}) {
  if (!can(user, 'students.promotion.approve')) throw new ServiceError('Forbidden', 403);
  const input = ConfirmSchema.parse(rawInput);
  const { schoolId } = user;
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const run = await tx.promotionRun.findFirst({ where: { id: runId, schoolId } });
    if (!run) throw new ServiceError('Promotion not found', 404);
    if (run.status !== 'DRAFT') throw new ServiceError('This promotion has already been confirmed', 409);
    const ctx = await loadContext(tx, schoolId, run.fromYearId);
    if (!ctx) throw new ServiceError('Academic year not found', 404);
    if (ctx.problems.length) throw new ServiceError(ctx.problems[0]!, 409);
    const term1 = ctx.term1!;

    const decisions = new Map(((run.lines as unknown as Decision[] | null) ?? []).map((d) => [d.studentId, d]));
    const stale = Array.from(decisions.keys()).filter((id) => !ctx.eligible.some((e) => e.studentId === id));
    if (stale.length) throw new ServiceError(`${stale.length} student(s) in this draft have since left or changed class. Open the draft and save it again before confirming.`, 409);
    const already = await tx.enrollment.count({ where: { termId: term1.id, studentId: { in: ctx.eligible.map((e) => e.studentId) } } });
    if (already) throw new ServiceError(`${already} student(s) already have a class in ${term1.name}`, 409);
    const openExits = await tx.studentExit.findMany({ where: { studentId: { in: ctx.eligible.map((e) => e.studentId) }, state: { in: ['STARTED', 'APPROVED'] } }, include: { student: { select: { fullName: true } } } });
    if (openExits.length) throw new ServiceError(`${openExits.map((x) => x.student.fullName).slice(0, 3).join(', ')} ${openExits.length > 1 ? 'have' : 'has'} a leaving process open. Finish or cancel it first.`, 409);

    const lines = ctx.eligible.map((e) => buildLine(e, ctx.classes, decisions.get(e.studentId)));
    const problems = lines.map((l) => lineProblem(l, ctx.classes)).filter((p): p is string => !!p);
    if (problems.length) throw new ServiceError(`${problems.slice(0, 5).join('. ')}${problems.length > 5 ? ` (and ${problems.length - 5} more)` : ''}`, 422);

    // Classes that do not exist yet are made now (e.g. Form 3 East when it has never had students).
    const made = new Map<string, string>();
    for (const l of lines) {
      if ((l.outcome === 'LEAVE' || l.outcome === 'COMPLETE') || l.toClassId) continue;
      const level = l.outcome === 'CONTINUE_LOWER_6' ? 5 : l.fromLevel + 1;
      const key = `${level}|${l.fromStream.toLowerCase()}`;
      if (!made.has(key)) made.set(key, (await findOrCreateClass(tx, schoolId, user.id, `Form ${level}`, l.fromStream)).id);
      l.toClassId = made.get(key)!;
    }
    const classNameOf = new Map((await tx.schoolClass.findMany({ where: { schoolId }, select: { id: true, name: true, capacity: true } })).map((c) => [c.id, c]));
    const incoming = new Map<string, number>();
    for (const l of lines) if (l.toClassId) incoming.set(l.toClassId, (incoming.get(l.toClassId) ?? 0) + 1);
    const over = Array.from(incoming).filter(([id, n]) => n > (classNameOf.get(id)?.capacity ?? 45));
    if (over.length && !input.acknowledgeFull) {
      throw new ServiceError(`${over.map(([id, n]) => `${classNameOf.get(id)!.name} would have ${n} students (capacity ${classNameOf.get(id)!.capacity})`).join('; ')}. Confirm that you want to go ahead.`, 409);
    }

    // 1. Term 3 enrollments end.
    const t3 = new Map<EnrollmentStatus, string[]>();
    for (const l of lines) {
      const status: EnrollmentStatus = l.outcome === 'REPEAT' ? 'REPEATED' : l.outcome === 'LEAVE' || l.outcome === 'COMPLETE' ? ENROLLMENT_END[l.exitReason!] ?? 'WITHDRAWN' : 'PROMOTED';
      const e = ctx.eligible.find((x) => x.studentId === l.studentId)!;
      t3.set(status, [...(t3.get(status) ?? []), e.enrollmentId]);
    }
    for (const [status, ids] of Array.from(t3)) await tx.enrollment.updateMany({ where: { id: { in: ids } }, data: { status, reason: 'Year-end promotion' } });
    await tx.enrollment.updateMany({ where: { termId: ctx.term3.id, id: { in: ctx.eligible.map((e) => e.enrollmentId) }, endDate: null }, data: { endDate: ctx.term3.endDate } });

    // 2. Term 1 enrollments begin for everyone who stays.
    const staying = lines.filter((l) => l.toClassId);
    await tx.enrollment.createMany({
      data: staying.map((l) => ({ schoolId, studentId: l.studentId, classId: l.toClassId!, termId: term1.id, status: 'ACTIVE' as const, startDate: term1.startDate, reason: 'Year-end promotion' })),
    });
    if (term1.status === 'OPEN') {
      const byClass = new Map<string, string[]>();
      for (const l of staying) byClass.set(l.toClassId!, [...(byClass.get(l.toClassId!) ?? []), l.studentId]);
      for (const [classId, ids] of Array.from(byClass)) await tx.student.updateMany({ where: { id: { in: ids } }, data: { currentClassId: classId } });
    }

    // 3. Leavers: status, leaving record, alumni.
    const leavers = lines.filter((l) => l.outcome === 'LEAVE' || l.outcome === 'COMPLETE');
    const lastDay = ctx.term3.endDate;
    const byStatus = new Map<string, string[]>();
    for (const l of leavers) byStatus.set(statusForExit(l.exitReason!), [...(byStatus.get(statusForExit(l.exitReason!)) ?? []), l.studentId]);
    for (const [status, ids] of Array.from(byStatus)) await tx.student.updateMany({ where: { id: { in: ids } }, data: { status: status as never, currentClassId: null } });
    if (leavers.length) {
      await tx.studentExit.createMany({
        data: leavers.map((l) => ({
          schoolId, studentId: l.studentId, reason: l.exitReason!, reasonNote: l.note ?? 'Year-end promotion', state: 'COMPLETED' as const, lastDay, clearance: [] as Prisma.InputJsonValue,
          overrideReason: 'Left at year end', startedById: run.createdById, approvedById: user.id, approvedAt: new Date(), completedAt: new Date(), resultingStatus: statusForExit(l.exitReason!), lastClassId: l.fromClassId,
        })),
      });
      await tx.alumnus.createMany({
        data: leavers.filter((l) => l.exitReason === 'COMPLETED_O_LEVEL' || l.exitReason === 'COMPLETED_A_LEVEL').map((l) => ({ schoolId, studentId: l.studentId, yearLeft: ctx.fromYear.year, lastClass: l.fromClassName })),
        skipDuplicates: true,
      });
      await suspendStudentMembers(tx, schoolId, user.id, leavers.map((l) => l.studentId), 'Left at year end');
      await tx.disciplineAction.updateMany({ where: { studentId: { in: leavers.map((l) => l.studentId) }, type: 'SUSPENSION', status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'ENDED' } });
    }

    // 4. One audit entry per student, then the summary.
    const actionFor = (l: PromotionLine): AuditAction => (l.outcome === 'REPEAT' ? 'REPEAT_STUDENT' : l.outcome === 'COMPLETE' ? 'GRADUATE_STUDENT' : l.outcome === 'LEAVE' ? (l.exitReason === 'TRANSFER' ? 'TRANSFER_OUT_STUDENT' : 'WITHDRAW_STUDENT') : 'PROMOTE_STUDENT');
    await tx.auditLog.createMany({
      data: lines.map((l) => ({
        schoolId, actorId: user.id, action: actionFor(l), entityType: 'Student', entityId: l.studentId,
        detail: `${l.fullName}: ${l.fromClassName} → ${l.toClassId ? classNameOf.get(l.toClassId)!.name : 'left the school'} (${ctx.fromYear.year} promotion)`,
        before: { classId: l.fromClassId } as Prisma.InputJsonValue,
        after: { outcome: l.outcome, classId: l.toClassId, exitReason: l.exitReason, runId } as Prisma.InputJsonValue,
      })),
    });
    const counts = Object.fromEntries(OUTCOMES.map((o) => [o, lines.filter((l) => l.outcome === o).length]));
    const summary = { counts, students: lines.length, leavers: leavers.length, classesCreated: Array.from(made.values()).length };
    await tx.promotionRun.update({ where: { id: runId }, data: { status: 'CONFIRMED', lines: lines as unknown as Prisma.InputJsonValue, summary: summary as Prisma.InputJsonValue, approvedById: user.id, confirmedAt: new Date() } });
    await logAudit(
      { schoolId, actorId: user.id, action: 'CONFIRM_PROMOTION', entityType: 'PromotionRun', entityId: runId, detail: `${ctx.fromYear.year} → ${ctx.toYear!.year}: ${lines.length} student(s), ${leavers.length} leaving`, after: summary as Prisma.InputJsonValue },
      tx,
    );
    await notifyUsers(tx, schoolId, [run.createdById], { type: 'PROMOTION_CONFIRMED', title: `The ${ctx.fromYear.year} promotion was confirmed`, body: `${lines.length} students, ${leavers.length} leaving`, link: '/students/promotion' });
    return { runId, ...summary };
  });
}

// ─── The report ──────────────────────────────────────────────────────────────

export interface PromotionReportData {
  schoolName: string;
  fromYear: number;
  toYear: number;
  confirmedAt: string;
  approvedBy: string;
  counts: Record<string, number>;
  /** Where each class went: "Form 2 East → Form 3 East: 41". */
  movements: { from: string; to: string; count: number }[];
  leavers: { fullName: string; admissionNumber: string; fromClassName: string; reason: ExitReason }[];
}

export async function promotionReport(user: AccessUser, runId: string): Promise<PromotionReportData> {
  const db = getScopedDb(user.schoolId, user.id);
  const run = await db.promotionRun.findFirst({ where: { id: runId }, include: { fromYear: { select: { year: true } }, toYear: { select: { year: true } } } });
  if (!run) throw new ServiceError('Promotion not found', 404);
  if (run.status !== 'CONFIRMED') throw new ServiceError('The report is made when the promotion is confirmed', 409);
  const lines = run.lines as unknown as PromotionLine[];
  const [school, approver, classes] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { name: true } }),
    run.approvedById ? db.user.findFirst({ where: { id: run.approvedById }, select: { fullName: true } }) : null,
    db.schoolClass.findMany({ select: { id: true, name: true } }),
  ]);
  const nameOf = new Map(classes.map((c) => [c.id, c.name]));
  const moves = new Map<string, number>();
  for (const l of lines) {
    const to = l.toClassId ? nameOf.get(l.toClassId) ?? l.toClassName ?? '—' : l.outcome === 'COMPLETE' ? 'Completed' : 'Left the school';
    const key = `${l.fromClassName}\u0000${to}`;
    moves.set(key, (moves.get(key) ?? 0) + 1);
  }
  return {
    schoolName: school.name, fromYear: run.fromYear.year, toYear: run.toYear.year, confirmedAt: run.confirmedAt?.toISOString() ?? '', approvedBy: approver?.fullName ?? '—',
    counts: ((run.summary as { counts?: Record<string, number> } | null)?.counts) ?? {},
    movements: Array.from(moves, ([k, count]) => { const [from, to] = k.split('\u0000'); return { from: from!, to: to!, count }; }).sort((a, b) => a.from.localeCompare(b.from, 'en', { numeric: true }) || a.to.localeCompare(b.to)),
    leavers: lines.filter((l) => l.outcome === 'LEAVE' || l.outcome === 'COMPLETE').map((l) => ({ fullName: l.fullName, admissionNumber: l.admissionNumber, fromClassName: l.fromClassName, reason: l.exitReason! })),
  };
}

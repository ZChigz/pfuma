// Moving students between classes (one or many), with the rules of the term:
//  • Every student at the school has exactly one Enrollment in the open term, and Student.currentClassId
//    is a cached copy updated in the same transaction.
//  • Before the open term has started a move only CORRECTS the Enrollment.
//  • Once the term has started a move needs approval (students.enrolment.approve). A person who holds that
//    permission approves their own request (the approver is recorded); anyone else's request waits as PENDING
//    and the approvers are notified.
//  • The Enrollment table allows one row per student per term, so a move inside a term changes the class on that
//    row and ClassMove keeps the history (from, to, date, reason, who asked, who approved).
import type { ClassMoveReason } from '@prisma/client';
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { can, type AccessUser } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { notifyUsers } from '@/lib/system/notifications';
import { requireOpenTerm } from '@/lib/academic/terms';
import { approverIds, idSchema, isoDateSchema, loadReachable, noteSchema } from '@/lib/students/common';
import { todayInHarare } from '@/lib/students/registration';
import { isAtSchool } from '@/lib/students/rules';

export const CLASS_MOVE_REASONS = ['WRONG_CLASS_AT_ADMISSION', 'SUBJECT_COMBINATION', 'BEHAVIOUR', 'PARENT_REQUEST', 'BALANCING_CLASS_SIZES', 'OTHER'] as const satisfies readonly ClassMoveReason[];
export const CLASS_MOVE_REASON_LABEL: Record<ClassMoveReason, string> = {
  WRONG_CLASS_AT_ADMISSION: 'Wrong class at admission',
  SUBJECT_COMBINATION: 'Subject combination',
  BEHAVIOUR: 'Behaviour',
  PARENT_REQUEST: 'Parent request',
  BALANCING_CLASS_SIZES: 'Balancing class sizes',
  OTHER: 'Other',
};

type Actor = AccessUser & { fullName?: string };
const actorName = (u: Actor) => u.fullName ?? u.id;

export const MoveClassSchema = z
  .object({
    studentIds: z.array(idSchema).min(1, 'Choose at least one student').max(500),
    toClassId: idSchema,
    effectiveDate: isoDateSchema.optional(),
    reason: z.enum(CLASS_MOVE_REASONS, { error: 'Choose a reason' }),
    reasonNote: noteSchema(300),
    /** The person has seen "this class is full" and wants to go ahead. */
    acknowledgeFull: z.boolean().default(false),
  })
  .refine((v) => v.reason !== 'OTHER' || !!v.reasonNote, { path: ['reasonNote'], message: 'Say what the reason is' });
export type MoveClassInput = z.input<typeof MoveClassSchema>;

export interface MoveWarning { code: 'CLASS_FULL'; message: string }

export interface MovePreview {
  mode: 'CORRECTION' | 'MID_TERM';
  /** Whether the move happens now (true) or waits for an approver (false). */
  appliesNow: boolean;
  className: string;
  capacity: number;
  currentSize: number;
  newSize: number;
  warnings: MoveWarning[];
  termName: string;
}

export interface MoveResult extends MovePreview { applied: number; pending: number }

async function applyMove(
  tx: Db, schoolId: string, actorId: string,
  move: { id: string; studentId: string; toClassId: string; reason: ClassMoveReason; reasonNote: string | null },
  ctx: { termId: string; studentName: string; fromName: string | null; toName: string; approvedBy: string | null },
) {
  const enrollment = await tx.enrollment.findUnique({ where: { studentId_termId: { studentId: move.studentId, termId: ctx.termId } } });
  if (!enrollment || enrollment.status !== 'ACTIVE') throw new ServiceError(`${ctx.studentName} has no active class in this term`, 409);
  await tx.enrollment.update({
    where: { id: enrollment.id },
    data: { classId: move.toClassId, reason: `${CLASS_MOVE_REASON_LABEL[move.reason]}${move.reasonNote ? `: ${move.reasonNote}` : ''}` },
  });
  await tx.student.update({ where: { id: move.studentId }, data: { currentClassId: move.toClassId } });
  await logAudit(
    {
      schoolId, actorId, action: 'TRANSFER_CLASS', entityType: 'Student', entityId: move.studentId,
      detail: `${ctx.studentName}: ${ctx.fromName ?? 'no class'} → ${ctx.toName}. ${CLASS_MOVE_REASON_LABEL[move.reason]}${ctx.approvedBy ? ` (approved by ${ctx.approvedBy})` : ' (correction before the term started)'}`,
      before: { classId: enrollment.classId, className: ctx.fromName },
      after: { classId: move.toClassId, className: ctx.toName, moveId: move.id },
    },
    tx,
  );
}

/**
 * Moves students to a class, or (dryRun) only reports what would happen, including the "class is full"
 * warning and the new class size. The whole batch succeeds or nothing changes.
 */
export async function moveClass(user: Actor, rawInput: MoveClassInput, opts: { dryRun?: boolean } = {}): Promise<MoveResult> {
  const input = MoveClassSchema.parse(rawInput);
  const { schoolId } = user;
  const canApprove = can(user, 'students.enrolment.approve');

  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const term = await requireOpenTerm(schoolId, tx);
    const today = todayInHarare();
    const termStart = term.startDate.toISOString().slice(0, 10);
    const mode: MovePreview['mode'] = today < termStart ? 'CORRECTION' : 'MID_TERM';

    const target = await tx.schoolClass.findFirst({ where: { id: input.toClassId, schoolId }, include: { level: true } });
    if (!target) throw new ServiceError('Class not found', 404);
    if (!target.active || !target.level.active) throw new ServiceError(`${target.name} is not in use`, 409);

    const students = await loadReachable(tx, user, input.studentIds, term.id, 'students.enrolment.manage');
    const away = students.filter((s) => !isAtSchool(s.status));
    if (away.length) throw new ServiceError(`Only students at the school can change class: ${away.map((s) => s.fullName).join(', ')}`, 409);

    const effective = input.effectiveDate ?? (mode === 'CORRECTION' ? termStart : today);
    if (mode === 'MID_TERM') {
      if (effective > today) throw new ServiceError('The effective date cannot be in the future', 422);
      // A term stays open until it is closed, so a move after its planned end date is still a move in this term.
      if (effective < termStart) throw new ServiceError(`The effective date cannot be before ${term.name} started (${termStart})`, 422);
    }

    const enrollments = await tx.enrollment.findMany({
      where: { termId: term.id, studentId: { in: students.map((s) => s.id) } },
      include: { class: { select: { id: true, name: true } } },
    });
    const byStudent = new Map(enrollments.map((e) => [e.studentId, e]));
    const missing = students.filter((s) => byStudent.get(s.id)?.status !== 'ACTIVE');
    if (missing.length) throw new ServiceError(`These students have no active class in ${term.name}: ${missing.map((s) => s.fullName).join(', ')}`, 409);
    const already = students.filter((s) => byStudent.get(s.id)!.classId === target.id);
    if (already.length) throw new ServiceError(`Already in ${target.name}: ${already.map((s) => s.fullName).join(', ')}`, 409);

    const pendingBefore = await tx.classMove.findMany({ where: { studentId: { in: students.map((s) => s.id) }, status: 'PENDING' }, select: { studentId: true } });
    if (pendingBefore.length) {
      const names = students.filter((s) => pendingBefore.some((p) => p.studentId === s.id)).map((s) => s.fullName);
      throw new ServiceError(`A class move is already waiting for approval: ${names.join(', ')}`, 409);
    }

    const currentSize = await tx.enrollment.count({ where: { classId: target.id, termId: term.id, status: 'ACTIVE' } });
    const newSize = currentSize + students.length;
    const warnings: MoveWarning[] = [];
    if (newSize > target.capacity) {
      warnings.push({ code: 'CLASS_FULL', message: `${target.name} has ${currentSize} students and its capacity is ${target.capacity}. After this move it will have ${newSize}.` });
    }
    const appliesNow = mode === 'CORRECTION' || canApprove;
    const preview: MovePreview = { mode, appliesNow, className: target.name, capacity: target.capacity, currentSize, newSize, warnings, termName: term.name };
    if (opts.dryRun) return { ...preview, applied: 0, pending: 0 };
    if (warnings.length && !input.acknowledgeFull) {
      throw new ServiceError(`${warnings[0]!.message} Confirm that you want to go ahead.`, 409);
    }

    for (const s of students) {
      const from = byStudent.get(s.id)!;
      const move = await tx.classMove.create({
        data: {
          schoolId, studentId: s.id, fromClassId: from.classId, toClassId: target.id, termId: term.id,
          effectiveDate: new Date(`${effective}T00:00:00Z`), reason: input.reason, reasonNote: input.reasonNote ?? null,
          requestedById: user.id, status: appliesNow ? 'APPROVED' : 'PENDING',
          approvedById: mode === 'MID_TERM' && appliesNow ? user.id : null, decidedAt: appliesNow ? new Date() : null,
        },
      });
      if (appliesNow) {
        await applyMove(tx, schoolId, user.id, { id: move.id, studentId: s.id, toClassId: target.id, reason: input.reason, reasonNote: input.reasonNote ?? null },
          { termId: term.id, studentName: s.fullName, fromName: from.class.name, toName: target.name, approvedBy: mode === 'MID_TERM' ? actorName(user) : null });
      } else {
        await logAudit(
          {
            schoolId, actorId: user.id, action: 'REQUEST_CLASS_MOVE', entityType: 'ClassMove', entityId: move.id,
            detail: `${s.fullName}: ${from.class.name} → ${target.name}. ${CLASS_MOVE_REASON_LABEL[input.reason]}`,
            after: { studentId: s.id, from: from.class.name, to: target.name, effectiveDate: effective, reason: input.reason },
          },
          tx,
        );
      }
    }

    if (!appliesNow) {
      const approvers = await approverIds(tx, schoolId, 'students.enrolment.approve', user.id);
      await notifyUsers(tx, schoolId, approvers, {
        type: 'CLASS_MOVE_WAITING',
        title: `${students.length} class move${students.length === 1 ? '' : 's'} to ${target.name} waiting for approval`,
        body: students.map((s) => s.fullName).slice(0, 5).join(', ') + (students.length > 5 ? ' …' : ''),
        link: '/students?moves=pending',
      });
    }
    return { ...preview, applied: appliesNow ? students.length : 0, pending: appliesNow ? 0 : students.length };
  });
}

/** Approve or decline a move that is waiting. Needs students.enrolment.approve; the approver is recorded. */
export async function decideClassMove(user: Actor, moveId: string, decision: 'APPROVE' | 'REJECT', note?: string) {
  if (!can(user, 'students.enrolment.approve')) throw new ServiceError('Forbidden', 403);
  const { schoolId } = user;
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const move = await tx.classMove.findFirst({
      where: { id: moveId, schoolId },
      include: { student: { select: { id: true, fullName: true, status: true } }, from: { select: { name: true } }, to: { select: { name: true, active: true } } },
    });
    if (!move) throw new ServiceError('Class move not found', 404);
    if (move.status !== 'PENDING') throw new ServiceError('This class move has already been decided', 409);

    if (decision === 'REJECT') {
      await tx.classMove.update({ where: { id: moveId }, data: { status: 'REJECTED', approvedById: user.id, decidedAt: new Date() } });
      await logAudit({ schoolId, actorId: user.id, action: 'REJECT_CLASS_MOVE', entityType: 'ClassMove', entityId: moveId, detail: `${move.student.fullName}: ${move.from?.name ?? '—'} → ${move.to.name} declined${note ? `: ${note}` : ''}` }, tx);
      await notifyUsers(tx, schoolId, [move.requestedById], { type: 'CLASS_MOVE_DECIDED', title: `Class move for ${move.student.fullName} was declined`, body: note, link: `/students/${move.studentId}` });
      return { status: 'REJECTED' as const };
    }

    if (!isAtSchool(move.student.status)) throw new ServiceError(`${move.student.fullName} is no longer at the school`, 409);
    if (!move.to.active) throw new ServiceError(`${move.to.name} is not in use`, 409);
    const term = await requireOpenTerm(schoolId, tx);
    await applyMove(tx, schoolId, user.id, { id: move.id, studentId: move.studentId, toClassId: move.toClassId, reason: move.reason, reasonNote: move.reasonNote },
      { termId: term.id, studentName: move.student.fullName, fromName: move.from?.name ?? null, toName: move.to.name, approvedBy: actorName(user) });
    await tx.classMove.update({ where: { id: moveId }, data: { status: 'APPROVED', approvedById: user.id, decidedAt: new Date() } });
    await logAudit({ schoolId, actorId: user.id, action: 'APPROVE_CLASS_MOVE', entityType: 'ClassMove', entityId: moveId, detail: `${move.student.fullName}: ${move.from?.name ?? '—'} → ${move.to.name} approved` }, tx);
    await notifyUsers(tx, schoolId, [move.requestedById], { type: 'CLASS_MOVE_DECIDED', title: `Class move for ${move.student.fullName} was approved`, link: `/students/${move.studentId}` });
    return { status: 'APPROVED' as const };
  });
}

/** Moves waiting for a decision, oldest first. */
export async function pendingClassMoves(user: AccessUser) {
  const db = getScopedDb(user.schoolId, user.id);
  const rows = await db.classMove.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    include: { student: { select: { id: true, fullName: true, admissionNumber: true } }, from: { select: { name: true } }, to: { select: { name: true } } },
  });
  return rows.map((m) => ({
    id: m.id, studentId: m.student.id, studentName: m.student.fullName, admissionNumber: m.student.admissionNumber,
    from: m.from?.name ?? null, to: m.to.name, effectiveDate: m.effectiveDate.toISOString().slice(0, 10),
    reason: CLASS_MOVE_REASON_LABEL[m.reason], reasonNote: m.reasonNote, requestedAt: m.createdAt.toISOString(),
  }));
}

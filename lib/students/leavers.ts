// Leaving is a short process with a clearance check, so no student leaves owing books or fees without the
// school knowing:
//   1. Start: the reason and the last day attended (a transfer also needs the school and district).
//   2. Clearance: fees (Finance), library books (Library), hostel property, school property and textbooks,
//      sports kit. A line is filled in by its module when that module is on, and ticked by hand otherwise.
//   3. Approval (students.leavers.approve). A student can leave with items outstanding when the approver says why.
//   4. Finish: sets the status, ends the Enrollment on the last day, makes the alumni record for those who
//      completed O or A Level, and leaves the student off class lists.
// Students are never deleted: the status changes and the history stays. A former student can rejoin on the old record.
import type { ExitReason, Prisma } from '@prisma/client';
import { owedBy } from '@/lib/finance/external';
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { can, type AccessUser } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { suspendStudentMembers } from '@/lib/library';
import { notifyUsers } from '@/lib/system/notifications';
import { generateLetterTx } from '@/lib/students/documents';
import { approverIds, idSchema, isoDateSchema, loadReachable, noteSchema } from '@/lib/students/common';
import { todayInHarare } from '@/lib/students/registration';
import { canRejoin, canStartLeaving, EXIT_REASON_LABEL, statusForExit } from '@/lib/students/rules';

type Actor = AccessUser & { fullName?: string };

export const EXIT_REASONS = [
  'TRANSFER', 'COMPLETED_O_LEVEL', 'COMPLETED_A_LEVEL', 'WITHDRAWN_BY_GUARDIAN', 'RELOCATED_ABROAD', 'EXPELLED', 'DECEASED', 'OTHER',
] as const satisfies readonly ExitReason[];

// ─── Clearance ───────────────────────────────────────────────────────────────

export interface ClearanceItem {
  key: 'fees' | 'library' | 'hostel' | 'property' | 'sports_kit';
  label: string;
  /** auto: filled in by a module that is on. manual: ticked by hand. */
  source: 'auto' | 'manual';
  /** Nothing outstanding (auto), or ticked off (manual). */
  clear: boolean;
  /** What is outstanding, or "Clear". */
  detail: string;
}

const MANUAL_ITEMS: { key: ClearanceItem['key']; label: string }[] = [
  { key: 'hostel', label: 'Hostel property' },
  { key: 'property', label: 'School property and textbooks' },
  { key: 'sports_kit', label: 'Sports kit' },
];

const money = (n: number) => n.toFixed(2);

/** Fresh clearance lines. `previous` keeps what was ticked by hand. */
export async function buildClearance(tx: Db, schoolId: string, studentId: string, previous: ClearanceItem[] = []): Promise<ClearanceItem[]> {
  const off = new Set((await tx.schoolModule.findMany({ where: { schoolId, enabled: false }, select: { module: true } })).map((m) => m.module));
  const items: ClearanceItem[] = [];

  if (!off.has('finance')) {
    // The balance comes from Finance (or, for a school not yet on it, the first accounting tables); each currency on its own.
    const owed = (await owedBy(tx, schoolId, studentId)).map((o) => `${o.currency} ${money(o.owed)}`);
    items.push({ key: 'fees', label: 'Fees balance', source: 'auto', clear: owed.length === 0, detail: owed.length ? `${owed.join(' and ')} outstanding` : 'Clear' });
  } else {
    items.push({ key: 'fees', label: 'Fees balance', source: 'manual', clear: previous.find((p) => p.key === 'fees')?.clear ?? false, detail: previous.find((p) => p.key === 'fees')?.clear ? 'Clear' : 'Tick when the fees are settled' });
  }

  if (!off.has('facilities')) {
    const open = await tx.borrowing.findMany({
      where: { returnDate: null, member: { studentId } },
      select: { copy: { select: { book: { select: { title: true } } } } },
    });
    const fines = await tx.borrowing.aggregate({ where: { member: { studentId }, fineSettled: false, fineAmount: { gt: 0 } }, _sum: { fineAmount: true } });
    const owing = fines._sum.fineAmount?.toNumber() ?? 0;
    const parts = [
      ...(open.length ? [`${open.length} book${open.length === 1 ? '' : 's'} not returned (${open.map((b) => b.copy.book.title).slice(0, 3).join(', ')}${open.length > 3 ? ', …' : ''})`] : []),
      ...(owing > 0 ? [`fines ${money(owing)} unpaid`] : []),
    ];
    items.push({ key: 'library', label: 'Library books', source: 'auto', clear: parts.length === 0, detail: parts.length ? parts.join('; ') : 'Clear' });
  } else {
    const was = previous.find((p) => p.key === 'library');
    items.push({ key: 'library', label: 'Library books', source: 'manual', clear: was?.clear ?? false, detail: was?.clear ? 'Clear' : 'Tick when all books are back' });
  }

  for (const m of MANUAL_ITEMS) {
    const was = previous.find((p) => p.key === m.key);
    items.push({ key: m.key, label: m.label, source: 'manual', clear: was?.clear ?? false, detail: was?.clear ? 'Clear' : 'Not ticked yet' });
  }
  return items;
}

export const outstanding = (items: ClearanceItem[]) => items.filter((i) => !i.clear);

// ─── Start ───────────────────────────────────────────────────────────────────

export const StartLeavingSchema = z
  .object({
    studentId: idSchema,
    reason: z.enum(EXIT_REASONS, { error: 'Choose a reason' }),
    reasonNote: noteSchema(500),
    lastDay: isoDateSchema,
    destinationSchool: noteSchema(120),
    destinationDistrict: noteSchema(80),
  })
  .superRefine((v, ctx) => {
    if (v.reason === 'TRANSFER' && !v.destinationSchool) ctx.addIssue({ code: 'custom', path: ['destinationSchool'], message: 'Name the school the student is transferring to' });
    if (v.reason === 'TRANSFER' && !v.destinationDistrict) ctx.addIssue({ code: 'custom', path: ['destinationDistrict'], message: 'Give the district of that school' });
    if (v.reason === 'OTHER' && !v.reasonNote) ctx.addIssue({ code: 'custom', path: ['reasonNote'], message: 'Say what the reason is' });
  });
export type StartLeavingInput = z.input<typeof StartLeavingSchema>;

/** Starts the leaving process inside the caller's transaction (also used when an expulsion is confirmed). */
export async function startLeavingTx(tx: Db, user: Actor, rawInput: StartLeavingInput) {
  const input = StartLeavingSchema.parse(rawInput);
  const { schoolId } = user;
  const open = await tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' }, select: { id: true } });
  const [student] = await loadReachable(tx, user, [input.studentId], open?.id);
  if (!student) throw new ServiceError('Student not found', 404);
  if (!canStartLeaving(student.status)) throw new ServiceError(`${student.fullName} is not at the school (status ${student.status.toLowerCase()})`, 409);
  const admitted = await tx.student.findUniqueOrThrow({ where: { id: student.id }, select: { admissionDate: true, currentClassId: true } });
  if (new Date(`${input.lastDay}T00:00:00Z`) < admitted.admissionDate) throw new ServiceError('The last day attended cannot be before the admission date', 422);
  const existing = await tx.studentExit.findFirst({ where: { studentId: student.id, state: { in: ['STARTED', 'APPROVED'] } } });
  if (existing) throw new ServiceError(`${student.fullName} already has a leaving process open`, 409);

  const clearance = await buildClearance(tx, schoolId, student.id);
  const exit = await tx.studentExit.create({
    data: {
      schoolId, studentId: student.id, reason: input.reason, reasonNote: input.reasonNote ?? null, state: 'STARTED',
      lastDay: new Date(`${input.lastDay}T00:00:00Z`), destinationSchool: input.destinationSchool ?? null, destinationDistrict: input.destinationDistrict ?? null,
      clearance: clearance as unknown as Prisma.InputJsonValue, startedById: user.id, lastClassId: admitted.currentClassId,
    },
  });
  await logAudit(
    {
      schoolId, actorId: user.id, action: 'START_LEAVING', entityType: 'StudentExit', entityId: exit.id,
      detail: `${student.fullName}: ${EXIT_REASON_LABEL[input.reason]}, last day ${input.lastDay}`,
      after: { studentId: student.id, reason: input.reason, lastDay: input.lastDay, outstanding: outstanding(clearance).map((c) => c.key) },
    },
    tx,
  );
  const approvers = await approverIds(tx, schoolId, 'students.leavers.approve', user.id);
  await notifyUsers(tx, schoolId, approvers, {
    type: 'LEAVING_WAITING', title: `${student.fullName} is leaving: approval needed`, body: `${EXIT_REASON_LABEL[input.reason]}, last day ${input.lastDay}`,
    link: `/students/${student.id}?tab=overview`,
  });
  return exit;
}

export async function startLeaving(user: Actor, input: StartLeavingInput) {
  return getScopedDb(user.schoolId, user.id).$tx((tx) => startLeavingTx(tx, user, input));
}

// ─── Clearance by hand, approval, finish ─────────────────────────────────────

async function loadExit(tx: Db, schoolId: string, exitId: string) {
  const exit = await tx.studentExit.findFirst({ where: { id: exitId, schoolId }, include: { student: { select: { id: true, fullName: true, status: true, currentClassId: true } } } });
  if (!exit) throw new ServiceError('Leaving record not found', 404);
  return exit;
}

export async function tickClearance(user: Actor, exitId: string, key: ClearanceItem['key'], ticked: boolean) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const exit = await loadExit(tx, user.schoolId, exitId);
    if (exit.state === 'COMPLETED' || exit.state === 'CANCELLED') throw new ServiceError('This leaving process is closed', 409);
    const items = (exit.clearance as unknown as ClearanceItem[]);
    const item = items.find((i) => i.key === key);
    if (!item) throw new ServiceError('No such clearance line', 404);
    if (item.source === 'auto') throw new ServiceError(`${item.label} is filled in automatically and cannot be ticked by hand`, 409);
    const next = items.map((i) => (i.key === key ? { ...i, clear: ticked, detail: ticked ? 'Clear' : 'Not ticked yet' } : i));
    await tx.studentExit.update({ where: { id: exitId }, data: { clearance: next as unknown as Prisma.InputJsonValue } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'START_LEAVING', entityType: 'StudentExit', entityId: exitId, detail: `${exit.student.fullName}: ${item.label} ${ticked ? 'ticked' : 'unticked'}`, before: { [key]: item.clear }, after: { [key]: ticked } }, tx);
    return next;
  });
}

export const ApproveLeavingSchema = z.object({ overrideReason: noteSchema(500) });

/**
 * The Head approves. The clearance is checked again first (fees and books may have changed); with items
 * outstanding the approval needs a reason, which is recorded. The approver is recorded either way.
 */
export async function approveLeaving(user: Actor, exitId: string, rawInput: z.input<typeof ApproveLeavingSchema> = {}) {
  if (!can(user, 'students.leavers.approve')) throw new ServiceError('Forbidden', 403);
  const input = ApproveLeavingSchema.parse(rawInput);
  const { schoolId } = user;
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const exit = await loadExit(tx, schoolId, exitId);
    if (exit.state !== 'STARTED') throw new ServiceError(exit.state === 'APPROVED' ? 'Already approved' : 'This leaving process is closed', 409);
    const items = await buildClearance(tx, schoolId, exit.studentId, exit.clearance as unknown as ClearanceItem[]);
    const owing = outstanding(items);
    if (owing.length && (!input.overrideReason || input.overrideReason.length < 5)) {
      throw new ServiceError(`Outstanding: ${owing.map((i) => `${i.label} (${i.detail})`).join('; ')}. Give a reason (at least 5 characters) to approve the leaving anyway.`, 409);
    }
    await tx.studentExit.update({
      where: { id: exitId },
      data: { state: 'APPROVED', approvedById: user.id, approvedAt: new Date(), clearance: items as unknown as Prisma.InputJsonValue, overrideReason: owing.length ? input.overrideReason! : null },
    });
    await logAudit(
      {
        schoolId, actorId: user.id, action: 'APPROVE_LEAVING', entityType: 'StudentExit', entityId: exitId,
        detail: `${exit.student.fullName}: leaving approved${owing.length ? ` with ${owing.length} item(s) outstanding` : ''}`,
        before: { state: exit.state }, after: { state: 'APPROVED', approvedById: user.id, outstanding: owing.map((i) => i.key), overrideReason: owing.length ? input.overrideReason : null },
      },
      tx,
    );
    await notifyUsers(tx, schoolId, [exit.startedById], { type: 'LEAVING_APPROVED', title: `Leaving approved for ${exit.student.fullName}`, link: `/students/${exit.studentId}` });
    return { state: 'APPROVED' as const, outstanding: owing.map((i) => i.key) };
  });
}

export async function cancelLeaving(user: Actor, exitId: string, reason: string) {
  const why = z.string().trim().min(3, 'Give a reason').max(300).parse(reason);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const exit = await loadExit(tx, user.schoolId, exitId);
    if (exit.state === 'COMPLETED' || exit.state === 'CANCELLED') throw new ServiceError('This leaving process is closed', 409);
    await tx.studentExit.update({ where: { id: exitId }, data: { state: 'CANCELLED', reasonNote: [exit.reasonNote, `Cancelled: ${why}`].filter(Boolean).join(' — ') } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'START_LEAVING', entityType: 'StudentExit', entityId: exitId, detail: `${exit.student.fullName}: leaving cancelled. ${why}`, before: { state: exit.state }, after: { state: 'CANCELLED' } }, tx);
  });
}

const ENROLLMENT_END: Record<ExitReason, 'TRANSFERRED_OUT' | 'GRADUATED' | 'WITHDRAWN'> = {
  TRANSFER: 'TRANSFERRED_OUT', COMPLETED_O_LEVEL: 'GRADUATED', COMPLETED_A_LEVEL: 'GRADUATED',
  WITHDRAWN_BY_GUARDIAN: 'WITHDRAWN', RELOCATED_ABROAD: 'WITHDRAWN', EXPELLED: 'WITHDRAWN', DECEASED: 'WITHDRAWN', OTHER: 'WITHDRAWN',
};

/**
 * Finishes an approved leaving on or after the last day attended, and files the letter that goes with it: a transfer
 * letter for a transfer, a school leaving certificate for everyone else (not for a student who has died).
 * `conduct` is the Head's words for the transfer letter; without it the letter says only what the record shows.
 */
export async function completeLeaving(user: Actor, exitId: string, opts: { conduct?: string } = {}) {
  const { schoolId } = user;
  const today = todayInHarare();
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const exit = await loadExit(tx, schoolId, exitId);
    if (exit.state !== 'APPROVED') throw new ServiceError(exit.state === 'COMPLETED' ? 'This student has already left' : 'The Head must approve the leaving first', 409);
    const lastDay = exit.lastDay.toISOString().slice(0, 10);
    if (today < lastDay) throw new ServiceError(`Finish the leaving on or after the last day attended (${lastDay})`, 409);
    if (!canStartLeaving(exit.student.status)) throw new ServiceError(`${exit.student.fullName} is no longer at the school`, 409);

    const status = statusForExit(exit.reason);
    const term = await tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' } });
    const enrollment = term ? await tx.enrollment.findUnique({ where: { studentId_termId: { studentId: exit.studentId, termId: term.id } }, include: { class: { select: { name: true } } } }) : null;
    if (enrollment && enrollment.status === 'ACTIVE') {
      await tx.enrollment.update({ where: { id: enrollment.id }, data: { status: ENROLLMENT_END[exit.reason], endDate: exit.lastDay, reason: EXIT_REASON_LABEL[exit.reason] } });
    }
    await tx.student.update({ where: { id: exit.studentId }, data: { status, currentClassId: null } });
    await tx.studentExit.update({
      where: { id: exitId },
      data: { state: 'COMPLETED', completedAt: new Date(), resultingStatus: status, lastClassId: enrollment?.classId ?? exit.lastClassId },
    });
    // A pending or running suspension is over.
    await tx.disciplineAction.updateMany({ where: { studentId: exit.studentId, type: 'SUSPENSION', status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'ENDED' } });
    await suspendStudentMembers(tx, schoolId, user.id, [exit.studentId], `Student ${status.toLowerCase()}`);

    if (exit.reason === 'COMPLETED_O_LEVEL' || exit.reason === 'COMPLETED_A_LEVEL') {
      const lastClass = enrollment?.class.name ?? (exit.lastClassId ? (await tx.schoolClass.findUnique({ where: { id: exit.lastClassId }, select: { name: true } }))?.name : null) ?? null;
      await tx.alumnus.upsert({
        where: { studentId: exit.studentId },
        create: { schoolId, studentId: exit.studentId, yearLeft: exit.lastDay.getUTCFullYear(), lastClass },
        update: { yearLeft: exit.lastDay.getUTCFullYear(), lastClass },
      });
    }
    await logAudit(
      {
        schoolId, actorId: user.id, action: 'COMPLETE_LEAVING', entityType: 'Student', entityId: exit.studentId,
        detail: `${exit.student.fullName}: ${EXIT_REASON_LABEL[exit.reason]}, last day ${lastDay}. Status ${status.toLowerCase()}`,
        before: { status: exit.student.status, classId: exit.student.currentClassId }, after: { status, exitId, lastDay, approvedById: exit.approvedById },
      },
      tx,
    );
    let letter: { id: string; referenceNo: string | null } | null = null;
    if (exit.reason !== 'DECEASED') {
      const incidents = await tx.incidentStudent.count({ where: { studentId: exit.studentId } });
      const conduct = opts.conduct?.trim() || (incidents === 0 ? 'No disciplinary record at this school' : 'Please contact the school for the conduct record');
      const doc = await generateLetterTx(tx, user, exit.reason === 'TRANSFER'
        ? { type: 'LETTER_TRANSFER', studentId: exit.studentId, conduct }
        : { type: 'LETTER_LEAVING_CERTIFICATE', studentId: exit.studentId });
      letter = { id: doc.id, referenceNo: doc.referenceNo };
    }
    return { status, studentId: exit.studentId, exitId, reason: exit.reason, letter };
  });
}

// ─── Rejoin ──────────────────────────────────────────────────────────────────

export const RejoinSchema = z.object({
  studentId: idSchema,
  classId: idSchema,
  note: noteSchema(300),
  acknowledgeFull: z.boolean().default(false),
});

/** A former student is re-admitted from their old record: same admission number, same history. */
export async function rejoinStudent(user: Actor, rawInput: z.input<typeof RejoinSchema>) {
  const input = RejoinSchema.parse(rawInput);
  const { schoolId } = user;
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const term = await tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' } });
    if (!term) throw new ServiceError('No term is open. Open a term before re-admitting a student.', 409);
    const student = await tx.student.findFirst({ where: { id: input.studentId, schoolId }, select: { id: true, fullName: true, status: true, admissionNumber: true } });
    if (!student) throw new ServiceError('Student not found', 404);
    if (!canRejoin(student.status)) {
      throw new ServiceError(student.status === 'ACTIVE' || student.status === 'SUSPENDED' ? `${student.fullName} is already at the school` : `${student.fullName} cannot rejoin (status ${student.status.toLowerCase()})`, 409);
    }
    const klass = await tx.schoolClass.findFirst({ where: { id: input.classId, schoolId }, include: { level: true } });
    if (!klass || !klass.active || !klass.level.active) throw new ServiceError('Class not found or not in use', 404);
    const size = await tx.enrollment.count({ where: { classId: klass.id, termId: term.id, status: 'ACTIVE' } });
    if (size + 1 > klass.capacity && !input.acknowledgeFull) {
      throw new ServiceError(`${klass.name} has ${size} students and its capacity is ${klass.capacity}. After this it will have ${size + 1}. Confirm that you want to go ahead.`, 409);
    }

    const existing = await tx.enrollment.findUnique({ where: { studentId_termId: { studentId: student.id, termId: term.id } } });
    const startDate = new Date() > term.startDate ? new Date(`${todayInHarare()}T00:00:00Z`) : term.startDate;
    if (existing) {
      await tx.enrollment.update({ where: { id: existing.id }, data: { classId: klass.id, status: 'ACTIVE', endDate: null, startDate, reason: 'Rejoined' } });
    } else {
      await tx.enrollment.create({ data: { schoolId, studentId: student.id, classId: klass.id, termId: term.id, status: 'ACTIVE', startDate, reason: 'Rejoined' } });
    }
    await tx.student.update({ where: { id: student.id }, data: { status: 'ACTIVE', currentClassId: klass.id, entryType: 'RETURNING' } });
    await tx.libraryMember.updateMany({ where: { studentId: student.id }, data: { borrowingSuspended: false, suspensionReason: null } });
    await logAudit(
      {
        schoolId, actorId: user.id, action: 'REJOIN_STUDENT', entityType: 'Student', entityId: student.id,
        detail: `${student.fullName} (${student.admissionNumber}) rejoined ${klass.name}${input.note ? `. ${input.note}` : ''}`,
        before: { status: student.status }, after: { status: 'ACTIVE', classId: klass.id },
      },
      tx,
    );
    return { studentId: student.id, className: klass.name, admissionNumber: student.admissionNumber };
  });
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export const LEAVERS_PAGE_SIZE = 50;

/** Everyone who left, filterable by year, reason and last class, with their letters. */
export async function listLeavers(user: AccessUser, f: { year?: number; reason?: ExitReason; classId?: string; page?: number }) {
  const db = getScopedDb(user.schoolId, user.id);
  const where: Prisma.StudentExitWhereInput = {
    state: 'COMPLETED',
    ...(f.reason ? { reason: f.reason } : {}),
    ...(f.classId ? { lastClassId: f.classId } : {}),
    ...(f.year ? { lastDay: { gte: new Date(Date.UTC(f.year, 0, 1)), lt: new Date(Date.UTC(f.year + 1, 0, 1)) } } : {}),
  };
  const [total, rows] = await Promise.all([
    db.studentExit.count({ where }),
    db.studentExit.findMany({
      where, orderBy: [{ lastDay: 'desc' }, { createdAt: 'desc' }], skip: ((f.page ?? 1) - 1) * LEAVERS_PAGE_SIZE, take: LEAVERS_PAGE_SIZE,
      include: { student: { select: { id: true, fullName: true, admissionNumber: true, status: true, documents: { where: { generated: true, type: { in: ['LETTER_TRANSFER', 'LETTER_LEAVING_CERTIFICATE', 'LETTER_TESTIMONIAL'] } }, select: { id: true, type: true, referenceNo: true } } } } },
    }),
  ]);
  const classes = await db.schoolClass.findMany({ where: { id: { in: rows.flatMap((r) => (r.lastClassId ? [r.lastClassId] : [])) } }, select: { id: true, name: true } });
  const nameOf = new Map(classes.map((c) => [c.id, c.name]));
  return {
    total,
    rows: rows.map((r) => ({
      exitId: r.id, studentId: r.student.id, fullName: r.student.fullName, admissionNumber: r.student.admissionNumber, status: r.student.status,
      reason: r.reason, lastDay: r.lastDay.toISOString().slice(0, 10), lastClass: r.lastClassId ? nameOf.get(r.lastClassId) ?? null : null,
      destinationSchool: r.destinationSchool, letters: r.student.documents,
    })),
  };
}

export async function openLeaving(user: AccessUser, studentId: string) {
  const db = getScopedDb(user.schoolId, user.id);
  const exit = await db.studentExit.findFirst({ where: { studentId, state: { in: ['STARTED', 'APPROVED'] } } });
  if (!exit) return null;
  return {
    id: exit.id, state: exit.state, reason: exit.reason, reasonNote: exit.reasonNote, lastDay: exit.lastDay.toISOString().slice(0, 10),
    destinationSchool: exit.destinationSchool, destinationDistrict: exit.destinationDistrict,
    clearance: exit.clearance as unknown as ClearanceItem[], overrideReason: exit.overrideReason, approvedById: exit.approvedById,
  };
}

// Credit notes, discounts, bursaries and waivers. One against one charge; it lowers the balance only once a second person
// approves it, and never by more than is left of the charge. Closed terms do not block them: they lower what is owed, they do not bill.
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { amountSchema, audit, dayOf, idSchema, nameMap, nameOf, need, tellApprovers, whySchema, type Actor } from '@/lib/finance/common';
import { notifyUsers } from '@/lib/system/notifications';
import type { Cur } from '@/lib/finance/money';

const KINDS = ['CREDIT_NOTE', 'DISCOUNT', 'BURSARY', 'WAIVER', 'SIBLING', 'STAFF_CHILD', 'EARLY_PAYMENT', 'HARDSHIP', 'HEAD_DISCRETION', 'CORRECTION', 'SPONSOR'] as const;
export const KIND_LABEL: Record<(typeof KINDS)[number], string> = {
  CREDIT_NOTE: 'Credit note', DISCOUNT: 'Discount', BURSARY: 'Bursary', WAIVER: 'Waiver', SIBLING: 'Sibling discount', STAFF_CHILD: 'Staff child discount', EARLY_PAYMENT: 'Early payment discount',
  HARDSHIP: 'Hardship waiver', HEAD_DISCRETION: 'Head’s discretion', CORRECTION: 'Correction', SPONSOR: 'Sponsor award',
};

export const AdjustmentSchema = z.object({ chargeId: idSchema, kind: z.enum(KINDS), amount: amountSchema, reason: whySchema(5) });

export async function requestAdjustment(user: Actor, raw: unknown) {
  need(user, 'finance.adjustments.create');
  const input = AdjustmentSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const c = await tx.finCharge.findFirst({ where: { id: input.chargeId, schoolId: user.schoolId }, include: { voidRow: true, student: { select: { fullName: true } } } });
    if (!c) throw new ServiceError('Charge not found', 404);
    if (c.voidRow) throw new ServiceError('This charge was voided, so it cannot be adjusted', 409);
    const held = await tx.finAdjustment.aggregate({ where: { schoolId: user.schoolId, chargeId: c.id, status: { in: ['PENDING', 'APPROVED'] } }, _sum: { amountCents: true } });
    const room = c.amountCents - (held._sum.amountCents ?? 0);
    if (input.amount > room) throw new ServiceError(`Adjustments to this charge can total at most ${room} more cents`, 409);
    const a = await tx.finAdjustment.create({ data: { schoolId: user.schoolId, chargeId: c.id, kind: input.kind, amountCents: input.amount, reason: input.reason, createdById: user.id } });
    await audit(tx, user, 'REQUEST_ADJUSTMENT', 'FinAdjustment', a.id, `Asked for a ${KIND_LABEL[input.kind].toLowerCase()} of ${input.amount} cents on ${c.description} for ${c.student.fullName}`, undefined, {
      chargeId: c.id, kind: input.kind, amountCents: input.amount, currency: c.currency, reason: input.reason, status: 'PENDING',
    });
    await tellApprovers(tx, user, 'finance.adjustments.approve', { title: `${KIND_LABEL[input.kind]} to approve`, body: `${c.student.fullName}: ${c.description}`, link: '/finance/adjustments' });
    return { id: a.id };
  });
}

export async function decideAdjustment(user: Actor, id: string, decision: 'approve' | 'reject', rawNote?: unknown) {
  need(user, 'finance.adjustments.approve');
  const note = rawNote === undefined || rawNote === '' ? undefined : whySchema(3).parse(rawNote);
  if (decision === 'reject' && !note) throw new ServiceError('Give a reason for rejecting it', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.finAdjustment.findFirst({ where: { id, schoolId: user.schoolId }, include: { charge: { include: { voidRow: true, student: { select: { fullName: true } } } } } });
    if (!a) throw new ServiceError('Adjustment not found', 404);
    if (a.status !== 'PENDING') throw new ServiceError(`This adjustment was already ${a.status.toLowerCase()}`, 409);
    if (a.createdById === user.id) throw new ServiceError('You asked for this adjustment, so someone else must decide on it.', 403);
    if (a.charge.voidRow) throw new ServiceError('The charge was voided, so this adjustment is no longer needed', 409);
    const status = decision === 'approve' ? 'APPROVED' : 'REJECTED';
    const moved = await tx.finAdjustment.updateMany({ where: { id, schoolId: user.schoolId, status: 'PENDING' }, data: { status, decidedById: user.id, decidedAt: new Date(), decisionNote: note } });
    if (moved.count !== 1) throw new ServiceError('This adjustment was just decided by someone else', 409);
    await audit(tx, user, decision === 'approve' ? 'APPROVE_ADJUSTMENT' : 'REJECT_ADJUSTMENT', 'FinAdjustment', id,
      `${decision === 'approve' ? 'Approved' : 'Rejected'} the ${KIND_LABEL[a.kind].toLowerCase()} on ${a.charge.description} for ${a.charge.student.fullName}`,
      { status: 'PENDING', decidedById: null }, { status, decidedById: user.id, decisionNote: note ?? null, amountCents: a.amountCents });
    await notifyUsers(tx, user.schoolId, [a.createdById], { type: 'FINANCE', title: `${KIND_LABEL[a.kind]} ${status.toLowerCase()}`, body: `${a.charge.student.fullName}: ${a.charge.description}`, link: '/finance/adjustments' });
    return { id, status };
  });
}

export interface AdjustmentRow {
  id: string;
  chargeId: string;
  studentId: string;
  studentName: string;
  charge: string;
  currency: Cur;
  fundName: string;
  kind: (typeof KINDS)[number];
  amountCents: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdBy: string | null;
  createdById: string;
  createdAt: string;
  decidedBy: string | null;
  decisionNote: string | null;
}

export async function listAdjustments(user: Actor, f: { status?: 'PENDING' | 'APPROVED' | 'REJECTED'; studentId?: string; page?: number; pageSize?: number } = {}) {
  need(user, 'finance.adjustments.create', 'finance.adjustments.approve', 'finance.accounts.view');
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(5000, Math.max(1, f.pageSize ?? 50));
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const where: Prisma.FinAdjustmentWhereInput = { schoolId: user.schoolId, ...(f.status ? { status: f.status } : {}), ...(f.studentId ? { charge: { studentId: f.studentId } } : {}) };
    const [total, rows] = await Promise.all([
      tx.finAdjustment.count({ where }),
      tx.finAdjustment.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        include: { charge: { select: { description: true, currency: true, studentId: true, fund: { select: { name: true } }, student: { select: { fullName: true } } } } },
      }),
    ]);
    const names = await nameMap(tx, user.schoolId, rows.flatMap((r) => [r.createdById, r.decidedById]));
    const out: AdjustmentRow[] = rows.map((r) => ({
      id: r.id, chargeId: r.chargeId, studentId: r.charge.studentId, studentName: r.charge.student.fullName, charge: r.charge.description, currency: r.charge.currency, fundName: r.charge.fund.name,
      kind: r.kind, amountCents: r.amountCents, reason: r.reason, status: r.status, createdBy: nameOf(names, r.createdById), createdById: r.createdById, createdAt: r.createdAt.toISOString(),
      decidedBy: nameOf(names, r.decidedById), decisionNote: r.decisionNote,
    }));
    return { rows: out, total, page, pageSize };
  });
}

export { dayOf };

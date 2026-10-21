// Payment plans: an agreement with a guardian to pay a debt in instalments. The bursar records it; the Head approves a plan that runs longer than the
// current term. Each instalment shows Due, Paid or Missed as payments arrive (money paid since the plan started, taken in order); the guardian gets a
// text three days before each due date and the bursar is told when one is missed. A learner on a plan that is up to date shows as "On plan".
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { audit, currencySchema, dayOf, idSchema, isoDateSchema, loadFinSettings, nameMap, nameOf, need, tellApprovers, todayInHarare, whySchema, ymd, type Actor, amountSchema } from '@/lib/finance/common';
import { chargeLines } from '@/lib/finance/balances';
import { feePayerContacts, queueSms } from '@/lib/finance/sms';
import { formatMoney, type Cur } from '@/lib/finance/money';
import { notifyUsers } from '@/lib/system/notifications';

export const PlanSchema = z.object({
  guardianId: idSchema, studentIds: z.array(idSchema).max(12).optional(), currency: currencySchema,
  instalments: z.array(z.object({ dueDate: isoDateSchema, amount: amountSchema })).min(2, 'A plan has at least two instalments').max(24), notes: z.string().trim().max(300).optional(),
});

export async function createPlan(user: Actor, raw: unknown) {
  need(user, 'finance.plans.manage');
  const input = PlanSchema.parse(raw);
  const today = todayInHarare();
  const dates = input.instalments.map((i) => i.dueDate);
  if (dates.some((d, i) => i > 0 && d <= dates[i - 1]!)) throw new ServiceError('The instalments must fall on later and later dates', 422);
  if (dates[0]! < today) throw new ServiceError('The first instalment cannot be in the past', 422);
  const totalCents = input.instalments.reduce((s, i) => s + i.amount, 0);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const kids = (await tx.studentGuardian.findMany({ where: { guardianId: input.guardianId, student: { schoolId: user.schoolId } }, select: { studentId: true } })).map((k) => k.studentId);
    if (kids.length === 0) throw new ServiceError('Guardian not found', 404);
    const studentIds = input.studentIds?.length ? input.studentIds : kids;
    if (studentIds.some((s) => !kids.includes(s))) throw new ServiceError('A learner in the plan is not a child of this guardian', 422);
    const lines = await chargeLines(tx, user.schoolId, { studentIds, currency: input.currency });
    const owed = lines.reduce((s, l) => s + Math.max(0, l.outstanding), 0);
    if (owed <= 0) throw new ServiceError('There is nothing owed in that currency, so no plan is needed', 409);
    if (totalCents > owed) throw new ServiceError(`The plan is for ${formatMoney(totalCents, input.currency)} but only ${formatMoney(owed, input.currency)} is owed`, 422);
    const open = await tx.academicTerm.findFirst({ where: { schoolId: user.schoolId, status: 'OPEN' }, select: { endDate: true } });
    const longer = !!open && dayOf(dates[dates.length - 1]!) > open.endDate;
    const plan = await tx.paymentPlan.create({
      data: {
        schoolId: user.schoolId, guardianId: input.guardianId, studentIds, currency: input.currency, totalCents, startDate: dayOf(today), notes: input.notes || null, status: longer ? 'PENDING_APPROVAL' : 'ACTIVE', createdById: user.id,
        instalments: { create: input.instalments.map((i) => ({ schoolId: user.schoolId, dueDate: dayOf(i.dueDate), amountCents: i.amount })) },
      },
    });
    await audit(tx, user, 'SAVE_PAYMENT_PLAN', 'PaymentPlan', plan.id, `Recorded a payment plan of ${formatMoney(totalCents, input.currency)} in ${input.instalments.length} instalments`, undefined, {
      guardianId: input.guardianId, studentIds, currency: input.currency, totalCents, instalments: input.instalments.length, status: plan.status,
    });
    if (longer) await tellApprovers(tx, user, 'finance.plans.approve', { title: 'Payment plan to approve', body: 'It runs beyond this term', link: '/finance/plans' });
    return { id: plan.id, status: plan.status };
  });
}

export async function decidePlan(user: Actor, id: string, decision: 'approve' | 'reject', rawNote?: unknown) {
  need(user, 'finance.plans.approve');
  const note = rawNote === undefined || rawNote === '' ? undefined : whySchema(3).parse(rawNote);
  if (decision === 'reject' && !note) throw new ServiceError('Give a reason for rejecting it', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const p = await tx.paymentPlan.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!p) throw new ServiceError('Plan not found', 404);
    if (p.status !== 'PENDING_APPROVAL') throw new ServiceError('This plan does not wait for approval', 409);
    if (p.createdById === user.id) throw new ServiceError('You recorded this plan, so someone else must decide on it.', 403);
    const status = decision === 'approve' ? 'ACTIVE' : 'CANCELLED';
    await tx.paymentPlan.update({ where: { id }, data: { status, approvedById: decision === 'approve' ? user.id : null, approvedAt: decision === 'approve' ? new Date() : null, notes: note ? `${p.notes ?? ''} ${note}`.trim() : p.notes } });
    await audit(tx, user, 'DECIDE_PAYMENT_PLAN', 'PaymentPlan', id, `${decision === 'approve' ? 'Approved' : 'Rejected'} a payment plan`, { status: 'PENDING_APPROVAL' }, { status, decidedById: user.id, note: note ?? null });
    await notifyUsers(tx, user.schoolId, [p.createdById], { type: 'FINANCE', title: `Payment plan ${decision === 'approve' ? 'approved' : 'rejected'}`, link: '/finance/plans' });
    return { id, status };
  });
}

export async function cancelPlan(user: Actor, id: string, rawReason: unknown) {
  need(user, 'finance.plans.manage', 'finance.plans.approve');
  const reason = whySchema(5).parse(rawReason);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const p = await tx.paymentPlan.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!p || (p.status !== 'ACTIVE' && p.status !== 'PENDING_APPROVAL')) throw new ServiceError('Only a plan in force can be cancelled', 409);
    await tx.paymentPlan.update({ where: { id }, data: { status: 'CANCELLED', notes: `${p.notes ?? ''} Cancelled: ${reason}`.trim() } });
    await audit(tx, user, 'SAVE_PAYMENT_PLAN', 'PaymentPlan', id, `Cancelled a payment plan: ${reason}`, { status: p.status }, { status: 'CANCELLED', reason });
    return { id };
  });
}

/**
 * Brings every active plan's instalments up to date: the money paid since the plan began (by the learners or the family, in the plan's currency)
 * is taken against the instalments in order. Returns the instalments that just became missed.
 */
export async function refreshPlans(tx: Db, schoolId: string, today: string = todayInHarare()) {
  const plans = await tx.paymentPlan.findMany({ where: { schoolId, status: 'ACTIVE' }, include: { instalments: { orderBy: { dueDate: 'asc' } } } });
  const newlyMissed: { planId: string; guardianId: string; instalmentId: string; dueDate: string; amountCents: number; currency: Cur }[] = [];
  for (const p of plans) {
    const paid = (await tx.finPayment.aggregate({
      where: { schoolId, status: 'VERIFIED', voidRow: null, currency: p.currency, verifiedAt: { gte: p.createdAt }, OR: [{ studentId: { in: p.studentIds } }, { guardianId: p.guardianId }] }, _sum: { amountCents: true },
    }))._sum.amountCents ?? 0;
    let covered = paid; let all = true;
    for (const i of p.instalments) {
      const due = ymd(i.dueDate);
      const isPaid = covered >= i.amountCents;
      if (isPaid) covered -= i.amountCents; else all = false;
      const status = isPaid ? 'PAID' : due < today ? 'MISSED' : 'DUE';
      if (status !== i.status) {
        await tx.paymentPlanInstalment.update({ where: { id: i.id }, data: { status, paidAt: status === 'PAID' ? new Date() : undefined } });
        if (status === 'MISSED') newlyMissed.push({ planId: p.id, guardianId: p.guardianId, instalmentId: i.id, dueDate: due, amountCents: i.amountCents, currency: p.currency });
      }
    }
    if (all) await tx.paymentPlan.update({ where: { id: p.id }, data: { status: 'COMPLETED' } });
  }
  return newlyMissed;
}

/** For the daily schedule: refresh the plans, text guardians three days before an instalment, and tell the bursar about missed ones. */
export async function runPlanSchedule(tx: Db, schoolId: string, today: string = todayInHarare()) {
  const settings = await loadFinSettings(tx, schoolId);
  const missed = await refreshPlans(tx, schoolId, today);
  const lead = ymd(new Date(dayOf(today).getTime() + settings.reminderLeadDays * 86_400_000));
  const due = await tx.paymentPlanInstalment.findMany({ where: { schoolId, status: 'DUE', dueDate: dayOf(lead), reminderSentAt: null, plan: { status: 'ACTIVE' } }, include: { plan: true } });
  let reminded = 0;
  for (const i of due) {
    const contacts = (await tx.studentGuardian.findMany({ where: { guardianId: i.plan.guardianId, canReceiveSms: true, student: { schoolId } }, select: { guardian: { select: { id: true, fullName: true, phone: true } } }, take: 1 })).map((g) => ({ guardianId: g.guardian.id, name: g.guardian.fullName, phone: g.guardian.phone }));
    const n = await queueSms(tx, schoolId, contacts, `Reminder: your school fees instalment of ${formatMoney(i.amountCents, i.plan.currency)} is due on ${ymd(i.dueDate)}.`, { key: `plan:${i.id}` });
    reminded += n;
    await tx.paymentPlanInstalment.update({ where: { id: i.id }, data: { reminderSentAt: new Date() } });
  }
  let alerted = 0;
  const fresh = await tx.paymentPlanInstalment.findMany({ where: { schoolId, status: 'MISSED', missedAlertAt: null, plan: { status: 'ACTIVE' } }, include: { plan: true } });
  if (fresh.length) {
    const staff = await tx.user.findMany({ where: { schoolId, active: true, isSupport: false, userRoles: { some: { role: { permissions: { some: { permissionKey: { in: ['finance.plans.manage', '*'] } } } } } } }, select: { id: true } });
    for (const i of fresh) {
      await notifyUsers(tx, schoolId, staff.map((s) => s.id), { type: 'FINANCE', title: 'A payment plan instalment was missed', body: `${formatMoney(i.amountCents, i.plan.currency)} due ${ymd(i.dueDate)}`, link: '/finance/plans', dedupeKey: `plan-missed:${i.id}` });
      await tx.paymentPlanInstalment.update({ where: { id: i.id }, data: { missedAlertAt: new Date() } });
      alerted++;
    }
  }
  return { missed: missed.length, reminded, alerted };
}

export async function listPlans(user: Actor, f: { guardianId?: string; studentId?: string; status?: string } = {}) {
  need(user, 'finance.plans.manage', 'finance.plans.approve', 'finance.statements.view', 'finance.accounts.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await refreshPlans(tx, user.schoolId);
    const rows = await tx.paymentPlan.findMany({
      where: { schoolId: user.schoolId, ...(f.guardianId ? { guardianId: f.guardianId } : {}), ...(f.studentId ? { studentIds: { has: f.studentId } } : {}), ...(f.status ? { status: f.status as never } : {}) },
      orderBy: { createdAt: 'desc' }, take: 200, include: { instalments: { orderBy: { dueDate: 'asc' } } },
    });
    const [guardians, students, names] = await Promise.all([
      tx.guardian.findMany({ where: { schoolId: user.schoolId, id: { in: rows.map((r) => r.guardianId) } }, select: { id: true, fullName: true, phone: true } }),
      tx.student.findMany({ where: { schoolId: user.schoolId, id: { in: rows.flatMap((r) => r.studentIds) } }, select: { id: true, fullName: true } }),
      nameMap(tx, user.schoolId, rows.flatMap((r) => [r.createdById, r.approvedById])),
    ]);
    const gm = new Map(guardians.map((g) => [g.id, g])); const sm = new Map(students.map((s) => [s.id, s.fullName]));
    return rows.map((p) => ({
      id: p.id, guardianId: p.guardianId, guardian: gm.get(p.guardianId)?.fullName ?? '', phone: gm.get(p.guardianId)?.phone ?? '', students: p.studentIds.map((i) => sm.get(i) ?? ''), currency: p.currency as Cur, totalCents: p.totalCents,
      status: p.status, createdBy: nameOf(names, p.createdById), createdById: p.createdById, approvedBy: nameOf(names, p.approvedById), notes: p.notes, startDate: ymd(p.startDate),
      upToDate: p.status === 'ACTIVE' && !p.instalments.some((i) => i.status === 'MISSED'),
      instalments: p.instalments.map((i) => ({ id: i.id, dueDate: ymd(i.dueDate), amountCents: i.amountCents, status: i.status })),
    }));
  });
}

/** Learners whose plan is in force and up to date, for the arrears list. */
export async function planStatusByStudent(tx: Db, schoolId: string, studentIds: string[]): Promise<Map<string, 'ON_PLAN' | 'PLAN_MISSED'>> {
  const out = new Map<string, 'ON_PLAN' | 'PLAN_MISSED'>();
  if (studentIds.length === 0) return out;
  const plans = await tx.paymentPlan.findMany({ where: { schoolId, status: 'ACTIVE', studentIds: { hasSome: studentIds } }, include: { instalments: { select: { status: true } } } });
  for (const p of plans) for (const sid of p.studentIds) {
    const state = p.instalments.some((i) => i.status === 'MISSED') ? 'PLAN_MISSED' : 'ON_PLAN';
    if (out.get(sid) !== 'PLAN_MISSED') out.set(sid, state);
  }
  return out;
}

// The daily cash-up. Each clerk who takes money counts the drawer and enters the cash per currency; the system shows what it expects (cash payments
// received, less cash refunds and petty cash paid out), the count and the difference; electronic payments of the day are listed apart. The bursar
// confirms the clerk's cash payments (they become Verified) and banks the cash, recording the deposit slip; the Head signs the day off. A difference
// of more than the allowed amount needs a written reason. ZiG paid against a dollar charge counts as the ZiG actually received.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { audit, dayOf, idSchema, isoDateSchema, loadFinSettings, nameMap, nameOf, need, tellApprovers, todayInHarare, whySchema, ymd, type Actor } from '@/lib/finance/common';
import { verifyPaymentTx } from '@/lib/finance/payments';
import { pettySpentOn } from '@/lib/finance/spending';
import { zeroTotals, type Cur, type Totals } from '@/lib/finance/money';
import { harareRange } from '@/lib/finance/reports';

export interface CashPosition {
  date: string;
  userId: string;
  /** Cash that should be in the drawer, per currency. */
  expected: Totals;
  cashPayments: { id: string; ref: string; student: string; currency: Cur; cents: number; zigCents: number | null; status: string }[];
  cashRefunds: Totals;
  petty: Totals;
  electronic: { count: number; pending: number; totals: Totals };
}

/** What one clerk's drawer should hold at the end of a day. */
export async function cashPosition(tx: Db, schoolId: string, userId: string, date: string): Promise<CashPosition> {
  const day = dayOf(date);
  const instants = harareRange(date, date);
  const [cashPays, refunds, petty, electronic] = await Promise.all([
    tx.finPayment.findMany({
      where: { schoolId, recordedById: userId, receivedOn: day, method: 'CASH', status: { not: 'REJECTED' }, voidRow: null },
      select: { id: true, receiptNumber: true, ackNumber: true, currency: true, amountCents: true, zigAmountCents: true, paidInZig: true, status: true, student: { select: { fullName: true } } }, orderBy: { recordedAt: 'asc' },
    }),
    tx.finRefund.findMany({ where: { schoolId, paidById: userId, status: 'PAID', method: 'CASH', paidAt: instants }, select: { amountCents: true, payment: { select: { currency: true } } } }),
    pettySpentOn(tx, schoolId, userId, day),
    tx.finPayment.findMany({ where: { schoolId, recordedById: userId, receivedOn: day, method: { not: 'CASH' }, status: { not: 'REJECTED' }, voidRow: null }, select: { amountCents: true, currency: true, status: true, paidInZig: true, zigAmountCents: true } }),
  ]);
  const expected = zeroTotals(); const cashRefunds = zeroTotals(); const etotals = zeroTotals();
  for (const p of cashPays) {
    if (p.paidInZig && p.zigAmountCents) expected.ZIG += p.zigAmountCents; else expected[p.currency] += p.amountCents;
  }
  for (const r of refunds) { expected[r.payment.currency] -= r.amountCents; cashRefunds[r.payment.currency] += r.amountCents; }
  for (const c of ['USD', 'ZIG'] as const) expected[c] -= petty[c];
  for (const e of electronic) etotals[e.currency] += e.amountCents;
  return {
    date, userId, expected: { USD: Math.max(0, expected.USD), ZIG: Math.max(0, expected.ZIG) },
    cashPayments: cashPays.map((p) => ({ id: p.id, ref: p.receiptNumber ?? p.ackNumber, student: p.student.fullName, currency: p.currency, cents: p.amountCents, zigCents: p.paidInZig ? p.zigAmountCents : null, status: p.status })),
    cashRefunds, petty, electronic: { count: electronic.length, pending: electronic.filter((e) => e.status === 'PENDING').length, totals: etotals },
  };
}

export interface CashUpView {
  id: string | null; date: string; userId: string; clerk: string | null; status: 'OPEN' | 'SUBMITTED' | 'CONFIRMED' | 'SIGNED_OFF';
  expected: Totals; counted: Totals; difference: Totals; explanation: string | null; depositRef: string | null; confirmedBy: string | null; signedOffBy: string | null;
  position: CashPosition;
}

const view = (row: { id: string; status: CashUpView['status']; expectedUsdCents: number; expectedZigCents: number; countedUsdCents: number; countedZigCents: number; differenceUsdCents: number; differenceZigCents: number; explanation: string | null; depositRef: string | null; confirmedById: string | null; signedOffById: string | null } | null, position: CashPosition, names: Map<string, string>, date: string, userId: string): CashUpView => ({
  id: row?.id ?? null, date, userId, clerk: nameOf(names, userId), status: row?.status ?? 'OPEN',
  expected: row ? { USD: row.expectedUsdCents, ZIG: row.expectedZigCents } : position.expected, counted: row ? { USD: row.countedUsdCents, ZIG: row.countedZigCents } : zeroTotals(),
  difference: row ? { USD: row.differenceUsdCents, ZIG: row.differenceZigCents } : zeroTotals(), explanation: row?.explanation ?? null, depositRef: row?.depositRef ?? null,
  confirmedBy: nameOf(names, row?.confirmedById), signedOffBy: nameOf(names, row?.signedOffById), position,
});

/** The signed-in clerk's cash-up for a day (today by default), submitted or still to do. */
export async function myCashUp(user: Actor, date?: string): Promise<CashUpView> {
  need(user, 'finance.cashup.submit', 'finance.cashup.confirm', 'finance.cashup.signoff');
  const day = date ?? todayInHarare();
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const [row, position] = await Promise.all([tx.cashUp.findUnique({ where: { schoolId_userId_date: { schoolId: user.schoolId, userId: user.id, date: dayOf(day) } } }), cashPosition(tx, user.schoolId, user.id, day)]);
    return view(row, position, await nameMap(tx, user.schoolId, [user.id, row?.confirmedById, row?.signedOffById]), day, user.id);
  });
}

export const SubmitSchema = z.object({
  date: isoDateSchema.optional(),
  countedUsd: z.union([z.string(), z.number()]), countedZig: z.union([z.string(), z.number()]).optional(), explanation: z.string().trim().max(300).optional(),
});

const cents = (v: string | number | undefined): number => {
  if (v === undefined || v === '') return 0;
  const t = String(v).trim().replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new ServiceError('Enter the counted cash in dollars and cents, such as 125.50', 422);
  const [w, f = ''] = t.split('.');
  return Number(w) * 100 + Number(f.padEnd(2, '0'));
};

/** The clerk counts the drawer and submits the day. */
export async function submitCashUp(user: Actor, raw: unknown) {
  need(user, 'finance.cashup.submit');
  const input = SubmitSchema.parse(raw);
  const day = input.date ?? todayInHarare();
  if (day > todayInHarare()) throw new ServiceError('A cash-up cannot be for a day that has not come', 422);
  const countedUsd = cents(input.countedUsd); const countedZig = cents(input.countedZig);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const settings = await loadFinSettings(tx, user.schoolId);
    const key = { schoolId_userId_date: { schoolId: user.schoolId, userId: user.id, date: dayOf(day) } };
    let row = await tx.cashUp.findUnique({ where: key });
    if (row && row.status !== 'OPEN') throw new ServiceError('This cash-up has already been submitted', 409);
    const pos = await cashPosition(tx, user.schoolId, user.id, day);
    const dUsd = countedUsd - pos.expected.USD; const dZig = countedZig - pos.expected.ZIG;
    if ((Math.abs(dUsd) > settings.cashToleranceCents || Math.abs(dZig) > settings.cashToleranceCents) && (input.explanation ?? '').trim().length < 5) {
      throw new ServiceError(`The count is out by ${(dUsd / 100).toFixed(2)} US$ and ${(dZig / 100).toFixed(2)} ZiG. Write down why before submitting.`, 422);
    }
    if (!row) row = await tx.cashUp.create({ data: { schoolId: user.schoolId, userId: user.id, date: dayOf(day) } });
    await tx.cashUp.update({
      where: { id: row.id },
      data: {
        status: 'SUBMITTED', submittedAt: new Date(), expectedUsdCents: pos.expected.USD, expectedZigCents: pos.expected.ZIG, countedUsdCents: countedUsd, countedZigCents: countedZig,
        differenceUsdCents: dUsd, differenceZigCents: dZig, explanation: input.explanation?.trim() || null,
      },
    });
    await audit(tx, user, 'SUBMIT_CASH_UP', 'CashUp', row.id, `Submitted the cash-up of ${day}`, { status: 'OPEN' }, { status: 'SUBMITTED', expected: pos.expected, counted: { USD: countedUsd, ZIG: countedZig }, difference: { USD: dUsd, ZIG: dZig }, explanation: input.explanation ?? null });
    await tellApprovers(tx, user, 'finance.cashup.confirm', { title: 'Cash-up to confirm', body: `${day}`, link: '/finance/cash-up' });
    return { id: row.id, difference: { USD: dUsd, ZIG: dZig } };
  });
}

export const ConfirmSchema = z.object({ depositRef: z.string().trim().max(60).optional() });

/** The bursar confirms the clerk's cash: each cash payment of the day becomes Verified, and the deposit slip is recorded. */
export async function confirmCashUp(user: Actor, id: string, raw?: unknown) {
  need(user, 'finance.cashup.confirm');
  const input = ConfirmSchema.parse(raw ?? {});
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const c = await tx.cashUp.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!c) throw new ServiceError('Cash-up not found', 404);
    if (c.status !== 'SUBMITTED') throw new ServiceError(c.status === 'OPEN' ? 'The clerk has not submitted this cash-up yet' : 'This cash-up has already been confirmed', 409);
    if (c.userId === user.id) throw new ServiceError('You counted this cash, so someone else must confirm it.', 403);
    const pays = await tx.finPayment.findMany({ where: { schoolId: user.schoolId, recordedById: c.userId, receivedOn: c.date, method: 'CASH', status: 'RECEIVED', voidRow: null }, select: { id: true } });
    let verified = 0;
    for (const p of pays) { await verifyPaymentTx(tx, user, p.id); verified++; }
    await tx.cashUp.update({ where: { id }, data: { status: 'CONFIRMED', confirmedById: user.id, confirmedAt: new Date(), depositRef: input.depositRef || null } });
    await audit(tx, user, 'CONFIRM_CASH_UP', 'CashUp', id, `Confirmed the cash-up of ${ymd(c.date)}: ${verified} cash payment(s) verified`, { status: 'SUBMITTED' }, { status: 'CONFIRMED', confirmedById: user.id, verified, depositRef: input.depositRef ?? null });
    await tellApprovers(tx, user, 'finance.cashup.signoff', { title: 'Day to sign off', body: ymd(c.date), link: '/finance/cash-up' });
    return { id, verified };
  });
}

/** The Head signs the day off, which is not the clerk and not the bursar who confirmed it. */
export async function signOffCashUp(user: Actor, id: string) {
  need(user, 'finance.cashup.signoff');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const c = await tx.cashUp.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!c) throw new ServiceError('Cash-up not found', 404);
    if (c.status !== 'CONFIRMED') throw new ServiceError('The bursar must confirm the cash-up first', 409);
    if (c.userId === user.id || c.confirmedById === user.id) throw new ServiceError('You counted or confirmed this cash, so someone else must sign the day off.', 403);
    await tx.cashUp.update({ where: { id }, data: { status: 'SIGNED_OFF', signedOffById: user.id, signedOffAt: new Date() } });
    await audit(tx, user, 'SIGN_OFF_CASH_UP', 'CashUp', id, `Signed off the day ${ymd(c.date)}`, { status: 'CONFIRMED' }, { status: 'SIGNED_OFF', signedOffById: user.id });
    return { id };
  });
}

/** The bursar sends a cash-up back to the clerk to recount. */
export async function returnCashUp(user: Actor, id: string, rawReason: unknown) {
  need(user, 'finance.cashup.confirm');
  const reason = whySchema(5).parse(rawReason);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const c = await tx.cashUp.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!c || c.status !== 'SUBMITTED') throw new ServiceError('Only a submitted cash-up can be sent back', 409);
    await tx.cashUp.update({ where: { id }, data: { status: 'OPEN', explanation: `Sent back: ${reason}` } });
    await audit(tx, user, 'SUBMIT_CASH_UP', 'CashUp', id, `Sent the cash-up of ${ymd(c.date)} back: ${reason}`, { status: 'SUBMITTED' }, { status: 'OPEN', reason });
    return { id };
  });
}

export interface ClerkDay { userId: string; clerk: string | null; status: 'Not started' | 'Submitted' | 'Signed off'; cashUpId: string | null; raw: CashUpView['status'] | null; expected: Totals; counted: Totals; difference: Totals }

/** Every clerk who took money (or has a cash-up) on a day, and where each has got to. */
export async function cashUpDay(user: Actor, date?: string): Promise<{ date: string; clerks: ClerkDay[] }> {
  need(user, 'finance.cashup.confirm', 'finance.cashup.signoff', 'finance.cashup.submit', 'finance.dashboard.view', 'finance.reports.view');
  const day = date ?? todayInHarare();
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const [rows, takers] = await Promise.all([
      tx.cashUp.findMany({ where: { schoolId: user.schoolId, date: dayOf(day) } }),
      tx.finPayment.groupBy({ by: ['recordedById'], where: { schoolId: user.schoolId, receivedOn: dayOf(day), status: { not: 'REJECTED' }, voidRow: null, method: { not: 'CREDIT_TRANSFER' } } }),
    ]);
    const ids = Array.from(new Set([...rows.map((r) => r.userId), ...takers.map((t) => t.recordedById)]));
    const names = await nameMap(tx, user.schoolId, ids);
    const clerks: ClerkDay[] = [];
    for (const uid of ids) {
      const r = rows.find((x) => x.userId === uid) ?? null;
      const pos = r ? null : await cashPosition(tx, user.schoolId, uid, day);
      clerks.push({
        userId: uid, clerk: nameOf(names, uid), raw: r?.status ?? null, cashUpId: r?.id ?? null,
        status: r?.status === 'SIGNED_OFF' ? 'Signed off' : r?.status === 'SUBMITTED' || r?.status === 'CONFIRMED' ? 'Submitted' : 'Not started',
        expected: r ? { USD: r.expectedUsdCents, ZIG: r.expectedZigCents } : pos!.expected, counted: r ? { USD: r.countedUsdCents, ZIG: r.countedZigCents } : zeroTotals(), difference: r ? { USD: r.differenceUsdCents, ZIG: r.differenceZigCents } : zeroTotals(),
      });
    }
    clerks.sort((a, b) => (a.clerk ?? '').localeCompare(b.clerk ?? ''));
    return { date: day, clerks };
  });
}

export async function getCashUp(user: Actor, id: string): Promise<CashUpView> {
  need(user, 'finance.cashup.confirm', 'finance.cashup.signoff', 'finance.cashup.submit');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.cashUp.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!r) throw new ServiceError('Cash-up not found', 404);
    const pos = await cashPosition(tx, user.schoolId, r.userId, ymd(r.date));
    return view(r, pos, await nameMap(tx, user.schoolId, [r.userId, r.confirmedById, r.signedOffById]), ymd(r.date), r.userId);
  });
}

export { idSchema };

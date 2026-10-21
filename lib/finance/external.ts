// What the rest of Pfuma asks of Finance: raise a charge (a lost library book, an exam entry fee), say what a student still owes
// (leaving clearance), whether a particular fee is settled (ZIMSEC entry), and the term's money for the dashboard. Each one reads the
// new tables for a school that runs its money in Finance and the older tables otherwise (lib/finance/legacy-guard.ts).
import { ServiceError } from '@/lib/api';
import type { Db } from '@/lib/scoped-db';
import { ensureFunds } from '@/lib/finance/common';
import { balancesOf, chargeLines } from '@/lib/finance/balances';
import { legacyRetired } from '@/lib/finance/legacy-guard';
import { CURRENCIES, type Cur } from '@/lib/finance/money';

/** True when this school keeps its money in the Finance module. */
export const onFinance = (tx: Db, schoolId: string) => legacyRetired(tx, schoolId);

const toCents = (amount: { toString(): string } | number): number => Math.round(Number(amount.toString()) * 100);

/** Raises one charge on a student's account in the fund named by `fund` (General unless said). Returns the id. */
export async function raiseCharge(
  tx: Db,
  o: { schoolId: string; actorId: string; studentId: string; termId: string; description: string; currency: Cur; amount: { toString(): string } | number; source: 'LIBRARY' | 'EXAM_ENTRY'; fund?: 'TUITION' | 'SDC' | 'BOARDING' | 'GENERAL' },
): Promise<{ id: string; legacy: boolean }> {
  if (!(await onFinance(tx, o.schoolId))) {
    const c = await tx.charge.create({ data: { schoolId: o.schoolId, studentId: o.studentId, termId: o.termId, label: o.description, currency: o.currency, amount: Number(o.amount.toString()) } });
    return { id: c.id, legacy: true };
  }
  const cents = toCents(o.amount);
  if (!Number.isInteger(cents) || cents <= 0) throw new ServiceError('The amount must be more than zero', 422);
  const funds = await ensureFunds(tx, o.schoolId);
  // A library fine and an exam entry fee are fee items of the school's list, each in its own fund.
  const item = await tx.feeItem.findFirst({ where: { schoolId: o.schoolId, name: o.source === 'LIBRARY' ? 'Library fine' : 'Exam fee', active: true } });
  const fund = (item && funds.find((f) => f.id === item.fundId && f.active)) || funds.find((f) => f.code === (o.fund ?? 'GENERAL') && f.active) || funds.find((f) => f.active);
  if (!fund) throw new ServiceError('The school has no fund that can take charges', 409);
  const c = await tx.finCharge.create({
    data: { schoolId: o.schoolId, studentId: o.studentId, termId: o.termId, fundId: fund.id, catalogItemId: item?.id ?? null, description: o.description, currency: o.currency, amountCents: cents, source: o.source, createdById: o.actorId },
  });
  return { id: c.id, legacy: false };
}

/** What each student still owes, per currency, in dollars-and-cents numbers (for the leaving clearance). */
export async function owedBy(tx: Db, schoolId: string, studentId: string): Promise<{ currency: Cur; owed: number }[]> {
  if (!(await onFinance(tx, schoolId))) {
    const [charges, payments] = await Promise.all([
      tx.charge.groupBy({ by: ['currency'], where: { studentId }, _sum: { amount: true } }),
      tx.payment.groupBy({ by: ['currency'], where: { studentId, status: 'VERIFIED' }, _sum: { amount: true } }),
    ]);
    return charges
      .map((c) => ({ currency: c.currency as Cur, owed: (c._sum.amount?.toNumber() ?? 0) - (payments.find((p) => p.currency === c.currency)?._sum.amount?.toNumber() ?? 0) }))
      .filter((r) => r.owed > 0.005);
  }
  const b = (await balancesOf(tx, schoolId, { studentIds: [studentId] })).get(studentId);
  return CURRENCIES.filter((c) => (b?.[c].outstanding ?? 0) > 0).map((c) => ({ currency: c, owed: b![c].outstanding / 100 }));
}

/** For each student: do they have a charge called `label`, and is all of it paid? (ZIMSEC entry fees.) */
export async function feeSettled(tx: Db, schoolId: string, studentIds: string[], label: string): Promise<Map<string, { charged: boolean; paid: boolean }>> {
  const out = new Map<string, { charged: boolean; paid: boolean }>();
  if (studentIds.length === 0) return out;
  if (!(await onFinance(tx, schoolId))) {
    const [charged, paid] = await Promise.all([
      tx.charge.groupBy({ by: ['studentId'], where: { schoolId, studentId: { in: studentIds }, label }, _sum: { amount: true } }),
      tx.payment.groupBy({ by: ['studentId'], where: { schoolId, studentId: { in: studentIds }, feeLabel: label, status: 'VERIFIED' }, _sum: { amount: true } }),
    ]);
    for (const id of studentIds) {
      const c = charged.find((x) => x.studentId === id)?._sum.amount?.toNumber() ?? 0;
      const p = paid.find((x) => x.studentId === id)?._sum.amount?.toNumber() ?? 0;
      out.set(id, { charged: c > 0, paid: c > 0 && p + 0.005 >= c });
    }
    return out;
  }
  const lines = (await chargeLines(tx, schoolId, { studentIds })).filter((l) => l.description === label);
  for (const id of studentIds) {
    const mine = lines.filter((l) => l.studentId === id);
    out.set(id, { charged: mine.length > 0, paid: mine.length > 0 && mine.every((l) => l.outstanding <= 0) });
  }
  return out;
}

/** Students who already have a charge called `label` (so the entry fee is raised once). */
export async function alreadyCharged(tx: Db, schoolId: string, studentIds: string[], label: string): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  if (!(await onFinance(tx, schoolId))) {
    return new Set((await tx.charge.findMany({ where: { schoolId, label, studentId: { in: studentIds } }, select: { studentId: true } })).map((c) => c.studentId));
  }
  return new Set((await tx.finCharge.findMany({ where: { schoolId, description: label, studentId: { in: studentIds }, voidRow: null }, select: { studentId: true } })).map((c) => c.studentId));
}

/** The dashboard's money for a term: billed, collected (verified in the term) and payments waiting, per currency. */
export async function termMoney(tx: Db, schoolId: string, term: { id: string } | null, window: { gte: Date; lt: Date } | undefined) {
  const zero = (): Record<Cur, number> => ({ USD: 0, ZIG: 0 });
  const billed = zero();
  const collected = zero();
  let pending = 0;
  if (!(await onFinance(tx, schoolId))) {
    const [b, c, p] = await Promise.all([
      term ? tx.charge.groupBy({ by: ['currency'], where: { schoolId, termId: term.id }, _sum: { amount: true } }) : Promise.resolve([]),
      window ? tx.payment.groupBy({ by: ['currency'], where: { schoolId, status: 'VERIFIED', verifiedAt: window }, _sum: { amount: true } }) : Promise.resolve([]),
      tx.payment.count({ where: { schoolId, status: 'PENDING' } }),
    ]);
    for (const r of b) billed[r.currency as Cur] = Number(r._sum.amount ?? 0);
    for (const r of c) collected[r.currency as Cur] = Number(r._sum.amount ?? 0);
    return { billed, collected, pending: p };
  }
  const [b, c, p] = await Promise.all([
    term ? tx.finCharge.groupBy({ by: ['currency'], where: { schoolId, termId: term.id, voidRow: null }, _sum: { amountCents: true } }) : Promise.resolve([]),
    window ? tx.finPayment.groupBy({ by: ['currency'], where: { schoolId, status: 'VERIFIED', voidRow: null, verifiedAt: window }, _sum: { amountCents: true } }) : Promise.resolve([]),
    tx.finPayment.count({ where: { schoolId, status: { in: ['PENDING', 'RECEIVED'] }, voidRow: null } }),
  ]);
  for (const r of b) billed[r.currency as Cur] = (r._sum.amountCents ?? 0) / 100;
  for (const r of c) collected[r.currency as Cur] = (r._sum.amountCents ?? 0) / 100;
  pending = p;
  return { billed, collected, pending };
}

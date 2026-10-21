// Balances are calculated, never stored:
//     charges − approved adjustments − allocated VERIFIED payments + refunds paid out, per currency (and per fund).
// A voided charge or payment is left out; a payment that is still pending or was rejected counts for nothing.
// Money that a verified payment holds beyond what it has settled is "credit on account", reported on its own.
import { Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import type { Db } from '@/lib/scoped-db';
import { CURRENCIES, outstandingOf, type Cur } from '@/lib/finance/money';

export interface ChargeLine {
  chargeId: string;
  studentId: string;
  termId: string;
  termStart: Date;
  fundId: string;
  currency: Cur;
  description: string;
  createdAt: Date;
  charged: number;
  adjusted: number;
  paid: number;
  refunded: number;
  outstanding: number;
}

export interface LineFilter {
  studentIds?: string[];
  termId?: string;
  /** Only charges from terms that started on or before this date. */
  upTo?: Date;
  fundId?: string;
  currency?: Cur;
}

const n = (v: unknown): number => Number(v ?? 0);

/** One line per charge that is not voided, with what has been adjusted, paid and refunded against it. */
export async function chargeLines(tx: Db, schoolId: string, f: LineFilter = {}): Promise<ChargeLine[]> {
  if (f.studentIds && f.studentIds.length === 0) return [];
  const where: Prisma.Sql[] = [Prisma.sql`c."schoolId" = ${schoolId}`, Prisma.sql`NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."chargeId" = c."id")`];
  if (f.studentIds) where.push(Prisma.sql`c."studentId" IN (${Prisma.join(f.studentIds)})`);
  if (f.termId) where.push(Prisma.sql`c."termId" = ${f.termId}`);
  if (f.upTo) where.push(Prisma.sql`t."startDate" <= ${f.upTo}`);
  if (f.fundId) where.push(Prisma.sql`c."fundId" = ${f.fundId}`);
  if (f.currency) where.push(Prisma.sql`c."currency" = ${f.currency}::"Currency"`);
  const rows = await tx.$queryRaw<
    { chargeId: string; studentId: string; termId: string; termStart: Date; fundId: string; currency: Cur; description: string; createdAt: Date; charged: bigint; adjusted: bigint; paid: bigint; refunded: bigint }[]
  >(Prisma.sql`
    SELECT c."id" AS "chargeId", c."studentId", c."termId", t."startDate" AS "termStart", c."fundId", c."currency"::text AS "currency", c."description", c."createdAt",
           c."amountCents"::bigint AS "charged",
           COALESCE((SELECT sum(a."amountCents") FROM "FinAdjustment" a WHERE a."chargeId" = c."id" AND a."status" = 'APPROVED'), 0)::bigint AS "adjusted",
           COALESCE((SELECT sum(al."amountCents") FROM "FinPaymentAllocation" al JOIN "FinPayment" p ON p."id" = al."paymentId"
                      WHERE al."chargeId" = c."id" AND p."status" = 'VERIFIED' AND NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."paymentId" = p."id")), 0)::bigint AS "paid",
           COALESCE((SELECT sum(r."amountCents") FROM "FinRefund" r JOIN "FinPayment" p ON p."id" = r."paymentId"
                      WHERE r."chargeId" = c."id" AND r."status" = 'PAID' AND NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."paymentId" = p."id")), 0)::bigint AS "refunded"
      FROM "FinCharge" c
      JOIN "AcademicTerm" t ON t."id" = c."termId"
     WHERE ${Prisma.join(where, ' AND ')}
     ORDER BY t."startDate", c."createdAt", c."id"`);
  return rows.map((r) => {
    const line = { ...r, charged: n(r.charged), adjusted: n(r.adjusted), paid: n(r.paid), refunded: n(r.refunded) };
    return { ...line, outstanding: outstandingOf(line) };
  });
}

export interface CreditLine {
  paymentId: string;
  studentId: string;
  /** The family payment's fee-payer guardian, when the money may settle any of their children's charges. */
  guardianId: string | null;
  /** Null: the payment is for any fund and is shared out in the school's order. */
  fundId: string | null;
  currency: Cur;
  receiptNumber: string | null;
  ackNumber: string;
  receivedOn: Date;
  amountCents: number;
  creditCents: number;
  /** The charge the payer said this money is for, if any. */
  targetChargeId: string | null;
}

/** Verified, unvoided payments that hold money beyond what they have settled (and what has been returned unallocated). */
export async function paymentCredits(tx: Db, schoolId: string, f: Pick<LineFilter, 'studentIds' | 'fundId' | 'currency'> = {}): Promise<CreditLine[]> {
  if (f.studentIds && f.studentIds.length === 0) return [];
  const where: Prisma.Sql[] = [Prisma.sql`p."schoolId" = ${schoolId}`, Prisma.sql`p."status" = 'VERIFIED'`, Prisma.sql`NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."paymentId" = p."id")`];
  if (f.studentIds) where.push(Prisma.sql`p."studentId" IN (${Prisma.join(f.studentIds)})`);
  if (f.fundId) where.push(Prisma.sql`p."fundId" = ${f.fundId}`);
  if (f.currency) where.push(Prisma.sql`p."currency" = ${f.currency}::"Currency"`);
  const rows = await tx.$queryRaw<
    { paymentId: string; studentId: string; guardianId: string | null; fundId: string | null; currency: Cur; receiptNumber: string | null; ackNumber: string; receivedOn: Date; amountCents: bigint; creditCents: bigint; targetChargeId: string | null }[]
  >(Prisma.sql`
    SELECT * FROM (
      SELECT p."id" AS "paymentId", p."studentId", p."guardianId", p."fundId", p."currency"::text AS "currency", p."receiptNumber", p."ackNumber", p."receivedOn", p."amountCents"::bigint AS "amountCents", p."targetChargeId",
             (p."amountCents"
               - COALESCE((SELECT sum(a."amountCents") FROM "FinPaymentAllocation" a WHERE a."paymentId" = p."id"), 0)
               - COALESCE((SELECT sum(r."amountCents") FROM "FinRefund" r WHERE r."paymentId" = p."id" AND r."chargeId" IS NULL AND r."status" <> 'REJECTED'), 0)
               - fin_transfer_out(p."id"))::bigint AS "creditCents"
        FROM "FinPayment" p
       WHERE ${Prisma.join(where, ' AND ')}
    ) x WHERE x."creditCents" > 0
    ORDER BY x."receivedOn", x."paymentId"`);
  return rows.map((r) => ({ ...r, amountCents: n(r.amountCents), creditCents: n(r.creditCents) }));
}

// ─── Rolling up ──────────────────────────────────────────────────────────────

export interface Cell {
  charged: number;
  adjusted: number;
  paid: number;
  refunded: number;
  outstanding: number;
  /** Money held beyond what it has settled. */
  credit: number;
}
export type ByCurrency = Record<Cur, Cell>;

export const emptyCell = (): Cell => ({ charged: 0, adjusted: 0, paid: 0, refunded: 0, outstanding: 0, credit: 0 });
export const emptyByCurrency = (): ByCurrency => ({ USD: emptyCell(), ZIG: emptyCell() });

/** Adds lines up under a key, each currency kept apart. */
export function rollup<K extends string>(lines: ChargeLine[], credits: CreditLine[], key: (x: { studentId: string; termId?: string; fundId: string }) => K): Map<K, ByCurrency> {
  const out = new Map<K, ByCurrency>();
  const slot = (k: K) => {
    let v = out.get(k);
    if (!v) out.set(k, (v = emptyByCurrency()));
    return v;
  };
  for (const l of lines) {
    const c = slot(key(l))[l.currency];
    c.charged += l.charged;
    c.adjusted += l.adjusted;
    c.paid += l.paid;
    c.refunded += l.refunded;
    c.outstanding += l.outstanding;
  }
  for (const cr of credits) slot(key({ studentId: cr.studentId, fundId: cr.fundId ?? '' }))[cr.currency].credit += cr.creditCents;
  return out;
}

/** Sums rolled-up rows across keys, still per currency. */
export function sumCells(rows: Iterable<ByCurrency>): ByCurrency {
  const t = emptyByCurrency();
  for (const r of Array.from(rows)) for (const c of CURRENCIES) for (const k of Object.keys(t[c]) as (keyof Cell)[]) t[c][k] += r[c][k];
  return t;
}

/** What each student owes, per currency, for the students given (all of the school's, when none are given). */
export async function balancesOf(tx: Db, schoolId: string, f: LineFilter = {}): Promise<Map<string, ByCurrency>> {
  const [lines, credits] = await Promise.all([chargeLines(tx, schoolId, f), paymentCredits(tx, schoolId, f)]);
  return rollup(lines, credits, (x) => x.studentId);
}

// ─── One student's account ───────────────────────────────────────────────────

export interface StatementEntry {
  at: string; // ISO timestamp
  kind: 'CHARGE' | 'ADJUSTMENT' | 'PAYMENT' | 'REFUND';
  id: string;
  description: string;
  currency: Cur;
  fundId: string | null;
  /** Raises what is owed (a charge, or a refund paid out). */
  debitCents: number;
  /** Lowers what is owed (an adjustment, or what a payment settled). */
  creditCents: number;
  /** PENDING / VERIFIED / REJECTED / APPROVED / VOIDED ... shown beside the entry. */
  status: string;
  /** Counted in the balance (false for pending, rejected and voided rows). */
  counts: boolean;
  /** Running balance in this entry's currency after it, over the entries that count. */
  runningCents: number;
  voidReason?: string | null;
}

export interface StudentAccount {
  studentId: string;
  byCurrency: ByCurrency;
  byFund: { fundId: string; byCurrency: ByCurrency }[];
  lines: ChargeLine[];
  credits: CreditLine[];
  statement: StatementEntry[];
}

export async function studentAccount(tx: Db, schoolId: string, studentId: string): Promise<StudentAccount> {
  const student = await tx.student.findFirst({ where: { id: studentId, schoolId }, select: { id: true } });
  if (!student) throw new ServiceError('Student not found', 404);
  const filter = { studentIds: [studentId] };
  const [lines, credits, charges, adjustments, payments, refunds] = await Promise.all([
    chargeLines(tx, schoolId, filter),
    paymentCredits(tx, schoolId, filter),
    tx.finCharge.findMany({ where: { schoolId, studentId }, include: { voidRow: true } }),
    tx.finAdjustment.findMany({ where: { schoolId, charge: { studentId } }, include: { charge: { select: { description: true, currency: true, fundId: true } } } }),
    tx.finPayment.findMany({ where: { schoolId, OR: [{ studentId }, { allocations: { some: { charge: { studentId } } } }] }, include: { voidRow: true, allocations: { select: { amountCents: true, charge: { select: { studentId: true } } } } } }),
    tx.finRefund.findMany({ where: { schoolId, charge: { studentId } }, include: { charge: { select: { description: true } }, payment: { select: { currency: true, fundId: true, receiptNumber: true, voidRow: true } } } }),
  ]);

  const rows: Omit<StatementEntry, 'runningCents'>[] = [];
  for (const c of charges) {
    rows.push({ at: c.createdAt.toISOString(), kind: 'CHARGE', id: c.id, description: c.description, currency: c.currency, fundId: c.fundId, debitCents: c.amountCents, creditCents: 0, status: c.voidRow ? 'VOIDED' : 'CHARGED', counts: !c.voidRow, voidReason: c.voidRow?.reason });
  }
  for (const a of adjustments) {
    rows.push({ at: (a.decidedAt ?? a.createdAt).toISOString(), kind: 'ADJUSTMENT', id: a.id, description: `${a.kind.replace('_', ' ').toLowerCase()}: ${a.charge.description}`, currency: a.charge.currency, fundId: a.charge.fundId, debitCents: 0, creditCents: a.amountCents, status: a.status, counts: a.status === 'APPROVED' });
  }
  for (const p of payments) {
    // What this payment settled of THIS learner's charges (a family payment also settles brothers' and sisters').
    const settled = p.allocations.filter((x) => x.charge.studentId === studentId).reduce((s, x) => s + x.amountCents, 0);
    const counts = p.status === 'VERIFIED' && !p.voidRow;
    if (counts && settled === 0 && p.studentId !== studentId) continue;
    rows.push({ at: new Date(p.receivedOn.getTime() + 1).toISOString(), kind: 'PAYMENT', id: p.id, description: `${p.receiptNumber ? `Receipt ${p.receiptNumber}` : `Acknowledgement ${p.ackNumber}`} (${p.method.replace('_', ' ').toLowerCase()})`, currency: p.currency, fundId: p.fundId, debitCents: 0, creditCents: counts ? settled : p.amountCents, status: p.voidRow ? 'VOIDED' : p.status, counts, voidReason: p.voidRow?.reason });
  }
  for (const r of refunds) {
    rows.push({ at: (r.paidAt ?? r.requestedAt).toISOString(), kind: 'REFUND', id: r.id, description: `Refund: ${r.charge?.description ?? ''}`.trim(), currency: r.payment.currency, fundId: r.payment.fundId, debitCents: r.amountCents, creditCents: 0, status: r.status, counts: r.status === 'PAID' && !r.payment.voidRow });
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));
  const running: Record<Cur, number> = { USD: 0, ZIG: 0 };
  const statement: StatementEntry[] = rows.map((r) => {
    if (r.counts) running[r.currency] += r.debitCents - r.creditCents;
    return { ...r, runningCents: running[r.currency] };
  });

  const byFundMap = rollup(lines, credits, (x) => x.fundId);
  return {
    studentId,
    byCurrency: sumCells(byFundMap.values()),
    byFund: Array.from(byFundMap.entries()).map(([fundId, byCurrency]) => ({ fundId, byCurrency })),
    lines,
    credits,
    statement,
  };
}

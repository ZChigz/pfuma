// The fee figures on the parent portal. A school that keeps its money in Finance shows what Finance calculates (charges − approved credit
// notes − verified payments + refunds paid out, each currency on its own); any other school still shows the first accounting tables.
import type { ScopedDb } from '@/lib/scoped-db';
import { balancesOf, emptyByCurrency } from '@/lib/finance/balances';
import { legacyRetired } from '@/lib/finance/legacy-guard';

type Dec = { toNumber(): number };
export interface PortalPayment { at: Date; method: string; amount: number; currency: 'USD' | 'ZIG'; zig: { amount: number; rate: number | null } | null }
export interface PortalFees {
  chargesUSD: number; chargesZiG: number; paidUSD: number; paidZiG: number; balUSD: number; balZiG: number;
  recentPayments: PortalPayment[];
}
export interface LegacyFeeRows {
  charges: { currency: 'USD' | 'ZIG'; amount: Dec }[];
  payments: { recordedAt: Date; method: string; amount: Dec; currency: 'USD' | 'ZIG'; paidInZig: boolean; zigAmountPaid: Dec | null; exchangeRateUsed: Dec | null }[];
}

export async function portalFees(db: ScopedDb, studentId: string, schoolId: string, legacy: LegacyFeeRows): Promise<PortalFees> {
  if (await legacyRetired(db, schoolId)) {
    const fin = await db.$tx(async (tx) => ({
      balances: (await balancesOf(tx, schoolId, { studentIds: [studentId] })).get(studentId) ?? emptyByCurrency(),
      payments: await tx.finPayment.findMany({
        where: { schoolId, studentId, status: 'VERIFIED', voidRow: null }, orderBy: [{ receivedOn: 'desc' }, { recordedAt: 'desc' }], take: 10,
        select: { receivedOn: true, method: true, amountCents: true, currency: true },
      }),
    }));
    const b = fin.balances;
    return {
      chargesUSD: (b.USD.charged - b.USD.adjusted) / 100, chargesZiG: (b.ZIG.charged - b.ZIG.adjusted) / 100,
      paidUSD: (b.USD.paid - b.USD.refunded) / 100, paidZiG: (b.ZIG.paid - b.ZIG.refunded) / 100,
      balUSD: b.USD.outstanding / 100, balZiG: b.ZIG.outstanding / 100,
      recentPayments: fin.payments.map((p) => ({ at: p.receivedOn, method: p.method, amount: p.amountCents / 100, currency: p.currency, zig: null })),
    };
  }
  const sum = (rows: { currency: string; amount: Dec }[], c: string) => rows.filter((r) => r.currency === c).reduce((n, r) => n + r.amount.toNumber(), 0);
  const chargesUSD = sum(legacy.charges, 'USD');
  const chargesZiG = sum(legacy.charges, 'ZIG');
  const paidUSD = sum(legacy.payments, 'USD');
  const paidZiG = sum(legacy.payments, 'ZIG');
  return {
    chargesUSD, chargesZiG, paidUSD, paidZiG, balUSD: chargesUSD - paidUSD, balZiG: chargesZiG - paidZiG,
    recentPayments: legacy.payments.slice(0, 10).map((p) => ({
      at: p.recordedAt, method: p.method, amount: p.amount.toNumber(), currency: p.currency,
      zig: p.paidInZig && p.zigAmountPaid ? { amount: p.zigAmountPaid.toNumber(), rate: p.exchangeRateUsed?.toNumber() ?? null } : null,
    })),
  };
}

// Exchange rates. Each row is a US dollars to ZiG rate, effective from a date and time, with its source. The rate used for a payment is the latest row in
// force on the payment date, not simply the newest. Rows are never edited or deleted; a correction is a new row. A warning shows when the newest is old.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { audit, loadFinSettings, nameOf, nameMap, need, type Actor } from '@/lib/finance/common';

export const RateSchema = z.object({
  usdToZig: z.number().positive('The rate must be more than zero').max(1_000_000), effectiveFrom: z.coerce.date().optional(), source: z.enum(['RBZ', 'SCHOOL', 'OTHER']).default('SCHOOL'),
  note: z.string().trim().max(200).optional(),
});

export interface RateRow { id: string; usdToZig: number; effectiveFrom: string; source: string; setBy: string | null; note: string | null; createdAt: string }

export async function listRates(user: Actor) {
  need(user, 'finance.rates.view', 'finance.rates.manage', 'finance.payments.record', 'finance.reports.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const [rows, settings] = await Promise.all([tx.exchangeRate.findMany({ where: { schoolId: user.schoolId }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }], take: 60 }), loadFinSettings(tx, user.schoolId)]);
    const names = await nameMap(tx, user.schoolId, rows.map((r) => r.setBy));
    const now = new Date();
    const inForce = rows.find((r) => r.effectiveFrom <= now) ?? null;
    const ageDays = inForce ? Math.floor((now.getTime() - inForce.effectiveFrom.getTime()) / 86_400_000) : null;
    return {
      rows: rows.map<RateRow>((r) => ({ id: r.id, usdToZig: Number(r.usdToZig), effectiveFrom: r.effectiveFrom.toISOString(), source: r.source, setBy: nameOf(names, r.setBy), note: r.note, createdAt: r.createdAt.toISOString() })),
      current: inForce ? { id: inForce.id, usdToZig: Number(inForce.usdToZig), effectiveFrom: inForce.effectiveFrom.toISOString() } : null,
      stale: ageDays === null || ageDays > settings.staleRateDays,
      ageDays, staleAfterDays: settings.staleRateDays,
    };
  });
}

export async function setRate(user: Actor, raw: unknown) {
  need(user, 'finance.rates.manage');
  const input = RateSchema.parse(raw);
  const from = input.effectiveFrom ?? new Date();
  if (from.getTime() > Date.now() + 60 * 864e5) throw new ServiceError('A rate cannot start more than 60 days from now', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const before = await tx.exchangeRate.findFirst({ where: { schoolId: user.schoolId, effectiveFrom: { lte: new Date() } }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
    const r = await tx.exchangeRate.create({ data: { schoolId: user.schoolId, usdToZig: input.usdToZig, setBy: user.id, note: input.note || null, effectiveFrom: from, source: input.source } });
    await audit(tx, user, 'SET_EXCHANGE_RATE', 'ExchangeRate', r.id, `1 USD = ZiG ${input.usdToZig} from ${from.toISOString()} (${input.source})${input.note ? `, ${input.note}` : ''}`,
      before ? { usdToZig: Number(before.usdToZig), effectiveFrom: before.effectiveFrom.toISOString() } : undefined, { usdToZig: input.usdToZig, effectiveFrom: from.toISOString(), source: input.source });
    return { id: r.id };
  });
}

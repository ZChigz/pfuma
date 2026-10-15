import type { Db } from '@/lib/scoped-db';

/**
 * The exchange rate in force at a moment: the latest row whose effectiveFrom is on or
 * before it — not simply the newest row. When two rows share an effectiveFrom, the one
 * created last wins (a correction). Rows are never edited, so this is stable history.
 */
export function rateFor(db: Db, at: Date = new Date()) {
  return db.exchangeRate.findFirst({
    where: { effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    include: { user: { select: { fullName: true } } },
  });
}

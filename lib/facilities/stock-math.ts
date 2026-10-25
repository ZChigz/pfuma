// Stock on hand and its cost, worked out from movements. Nothing here is stored: a quantity is the sum of the movements, and the cost of
// stock on hand is the weighted average of what came in (stock going out leaves at the average, so the average does not move).

export interface Moving {
  qty: number;
  unitCostCents: number;
}

export interface Position {
  qty: number;
  /** What the stock on hand cost, in cents (not rounded while it is worked out). */
  valueCents: number;
  /** Weighted average cost of one unit, in cents. */
  avgCents: number;
}

const EPS = 1e-9;

/** Replays movements in the order they happened. */
export function position(movements: Iterable<Moving>): Position {
  let qty = 0;
  let value = 0;
  for (const m of Array.from(movements)) {
    if (m.qty > 0) {
      value += m.qty * m.unitCostCents;
      qty += m.qty;
    } else if (m.qty < 0) {
      const avg = qty > EPS ? value / qty : 0;
      value -= -m.qty * avg;
      qty += m.qty;
      if (qty < EPS) { qty = Math.max(qty, 0); if (qty < EPS) value = 0; }
    }
  }
  return { qty: round3(qty), valueCents: Math.round(value), avgCents: qty > EPS ? Math.round(value / qty) : 0 };
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface LotBalance {
  lotId: string | null;
  expiry: string | null;
  qty: number;
}

/**
 * Takes `qty` out of the batches that expire first, then out of stock with no batch. Returns what to take from each, or null when there
 * is not enough in total.
 */
export function drawFirstExpiring(lots: LotBalance[], total: number, qty: number): { lotId: string | null; qty: number }[] | null {
  if (qty <= 0) return [];
  if (total + EPS < qty) return null;
  const dated = lots.filter((l) => l.lotId && l.qty > EPS).sort((a, b) => (a.expiry ?? '9999').localeCompare(b.expiry ?? '9999'));
  const lotted = dated.reduce((s, l) => s + l.qty, 0);
  const plan: { lotId: string | null; qty: number }[] = [];
  let left = qty;
  for (const l of dated) {
    if (left <= EPS) break;
    const take = Math.min(l.qty, left);
    plan.push({ lotId: l.lotId, qty: round3(take) });
    left -= take;
  }
  if (left > EPS) {
    // The rest comes from stock that was never put in a batch.
    const loose = total - lotted;
    if (loose + EPS < left) return null;
    plan.push({ lotId: null, qty: round3(left) });
  }
  return plan;
}

/** Whole units for things counted one by one (each, box); kg and litres may have fractions down to a gram or a millilitre. */
export function qtyOk(unit: 'EACH' | 'BOX' | 'KG' | 'LITRE', qty: number): boolean {
  if (!(qty > 0) || qty > 1_000_000) return false;
  return unit === 'KG' || unit === 'LITRE' ? Math.abs(qty * 1000 - Math.round(qty * 1000)) < 1e-6 : Number.isInteger(qty);
}

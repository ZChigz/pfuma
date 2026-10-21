// Money in Pfuma is a whole number of cents with a currency next to it, never a float, and the two currencies are never added.
// Pure functions only (no database), so pages, services and tests share them.
export type Cur = 'USD' | 'ZIG';
export const CURRENCIES: readonly Cur[] = ['USD', 'ZIG'] as const;

export const CURRENCY_LABEL: Record<Cur, string> = { USD: 'US dollars', ZIG: 'Zimbabwe Gold (ZiG)' };
const SYMBOL: Record<Cur, string> = { USD: 'US$', ZIG: 'ZiG ' };

/** The largest amount one row can hold (a PostgreSQL integer). */
export const MAX_CENTS = 2_000_000_000;

/**
 * Turns what a person typed ("12", "12.5", "1,250.00") or a number into whole cents, exactly. Anything with more than two
 * decimals, a sign, or letters is refused rather than rounded: rounding someone's money silently is a bug.
 */
export function parseCents(input: string | number): number {
  const text = typeof input === 'number' ? String(input) : input;
  const clean = text.trim().replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) throw new RangeError('Enter an amount in dollars and cents, such as 125.50');
  const [whole, frac = ''] = clean.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) throw new RangeError('That amount is too large');
  return cents;
}

/** 12550 → "125.50" (no currency; for inputs and files). */
export function plainAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** 125050 → "US$1,250.50"; -500 → "-US$5.00". */
export function formatMoney(cents: number, currency: Cur): string {
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}${SYMBOL[currency]}${whole}.${String(abs % 100).padStart(2, '0')}`;
}

/** Totals kept apart by currency. There is no function that adds one currency to another. */
export type Totals = Record<Cur, number>;
export const zeroTotals = (): Totals => ({ USD: 0, ZIG: 0 });

export function addTo(totals: Totals, currency: Cur, cents: number): Totals {
  totals[currency] += cents;
  return totals;
}

/** "US$1,200.00 · ZiG 30,000.00", leaving out a currency that has nothing in it. */
export function formatTotals(totals: Partial<Totals>, opts: { keepZero?: boolean } = {}): string {
  const parts = CURRENCIES.filter((c) => opts.keepZero || (totals[c] ?? 0) !== 0).map((c) => formatMoney(totals[c] ?? 0, c));
  return parts.length ? parts.join(' · ') : formatMoney(0, 'USD');
}

export const isCurrency = (v: unknown): v is Cur => v === 'USD' || v === 'ZIG';

// ─── Allocation ──────────────────────────────────────────────────────────────

export interface Owed { chargeId: string; outstandingCents: number }
export interface Split { chargeId: string; amountCents: number }

/**
 * Settles the oldest charges first. `owed` must already be in the order they should be settled (oldest term first) and hold
 * only charges of one student, one currency and one fund. Returns what to allocate; whatever is left over stays as credit.
 */
export function allocateOldestFirst(availableCents: number, owed: Owed[]): { splits: Split[]; leftCents: number } {
  let left = availableCents;
  const splits: Split[] = [];
  for (const o of owed) {
    if (left <= 0) break;
    if (o.outstandingCents <= 0) continue;
    const take = Math.min(left, o.outstandingCents);
    splits.push({ chargeId: o.chargeId, amountCents: take });
    left -= take;
  }
  return { splits, leftCents: left };
}

/** What is still owed on one charge: charged − approved adjustments − allocated verified payments + refunds paid out. */
export function outstandingOf(l: { charged: number; adjusted: number; paid: number; refunded: number }): number {
  return l.charged - l.adjusted - l.paid + l.refunded;
}

/**
 * Shares `availableCents` over the charges in proportion to what each still owes, in whole cents (the cents left over by rounding go
 * to the charges with the biggest remainders). Never gives a charge more than it owes; leaves the rest as credit.
 */
export function allocateProportional(availableCents: number, owed: Owed[]): { splits: Split[]; leftCents: number } {
  const open = owed.filter((o) => o.outstandingCents > 0);
  const total = open.reduce((s, o) => s + o.outstandingCents, 0);
  if (availableCents <= 0 || total === 0) return { splits: [], leftCents: Math.max(availableCents, 0) };
  const use = Math.min(availableCents, total);
  const shares = open.map((o) => {
    const exact = (use * o.outstandingCents) / total;
    return { chargeId: o.chargeId, cap: o.outstandingCents, base: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let left = use - shares.reduce((s, x) => s + x.base, 0);
  for (const x of [...shares].sort((a, b) => b.rem - a.rem)) {
    if (left <= 0) break;
    if (x.base < x.cap) { x.base += 1; left -= 1; }
  }
  const splits = shares.filter((x) => x.base > 0).map((x) => ({ chargeId: x.chargeId, amountCents: x.base }));
  return { splits, leftCents: availableCents - splits.reduce((s, x) => s + x.amountCents, 0) };
}

/** Whole US dollars from cents, rounding to the nearest dollar (used when fees are raised by a percentage). */
export const roundToDollar = (cents: number): number => Math.round(cents / 100) * 100;

/** Cents × basis points (10000 = 100%), rounded to the nearest cent. */
export const percentOf = (cents: number, bps: number): number => Math.round((cents * bps) / 10000);

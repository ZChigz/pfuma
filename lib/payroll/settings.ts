// Statutory settings with effective dates. Nothing is hard-coded in the calculation: the run picks, for its month, the newest table
// or rate whose effectiveFrom is on or before the first day of that month. The DEFAULT_* values below are only what a school starts
// with; its accountant must confirm them (the settings page shows "unconfirmed" until they do) before the first run.
import type { Cur, StatutoryRates, TaxBand } from '@/lib/payroll/calc';

export interface Dated<T> { effectiveFrom: string; value: T }

/** The entry in force on `month` (YYYY-MM). Throws when nothing is in force yet, so a run cannot silently use no tax. */
export function inForce<T>(entries: Dated<T>[], month: string, label: string): T {
  const first = `${month}-01`;
  const hit = entries.filter((e) => e.effectiveFrom <= first).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (!hit) throw new RangeError(`No ${label} is in force for ${month}. Add one in Payroll settings.`);
  return hit.value;
}

export interface RateSet {
  aidsLevyBps: number;
  nssaEmployeeBps: number;
  nssaEmployerBps: number;
  nssaCeilingCents: Record<Cur, number | null>;
  nssaDeductibleBeforePaye: boolean;
  zimdefBps: number;
}

/** Joins the dated settings into the rates one currency uses in `month`. */
export function ratesFor(currency: Cur, month: string, tables: Record<Cur, Dated<TaxBand[]>[]>, rates: Dated<RateSet>[]): StatutoryRates {
  const r = inForce(rates, month, 'statutory rates');
  return {
    bands: inForce(tables[currency], month, `${currency} tax table`),
    aidsLevyBps: r.aidsLevyBps,
    nssaEmployeeBps: r.nssaEmployeeBps,
    nssaEmployerBps: r.nssaEmployerBps,
    nssaCeilingCents: r.nssaCeilingCents[currency],
    nssaDeductibleBeforePaye: r.nssaDeductibleBeforePaye,
    zimdefBps: r.zimdefBps,
  };
}

// USD: CountryTaxCalc 2026 guide (reported, not verified against ZIMRA); tax-free US$100 and the 40% top rate match ZIMRA.
export const DEFAULT_USD_BANDS: TaxBand[] = [
  { fromCents: 0, rateBps: 0 },
  { fromCents: 10_000, rateBps: 2000 },
  { fromCents: 30_000, rateBps: 2500 },
  { fromCents: 300_000, rateBps: 4000 },
];

// ZiG: tax-free ZiG 2,800 and a 40% top rate are ZIMRA's. The middle bands here are the USD ones scaled by 28 and are a PLACEHOLDER:
// replace them with ZIMRA's published ZiG table before the first run that pays in ZiG.
export const DEFAULT_ZIG_BANDS: TaxBand[] = [
  { fromCents: 0, rateBps: 0 },
  { fromCents: 280_000, rateBps: 2000 },
  { fromCents: 840_000, rateBps: 2500 },
  { fromCents: 8_400_000, rateBps: 4000 },
];

export const DEFAULT_RATES: RateSet = {
  aidsLevyBps: 300,
  nssaEmployeeBps: 450,
  nssaEmployerBps: 450,
  nssaCeilingCents: { USD: 70_000, ZIG: null },
  nssaDeductibleBeforePaye: false,
  zimdefBps: 100,
};

/** Effective-from used for the seeded defaults: early enough to cover any run. */
export const DEFAULT_EFFECTIVE_FROM = '2026-01-01';

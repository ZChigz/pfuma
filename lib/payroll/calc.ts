// The payroll calculations, in one place and with no database: tax bands, AIDS levy, NSSA, ZIMDEF, pro-rating, casual pay and the
// "net moved more than 10%" flag. Every rate and table is passed in (they are school settings with effective dates, never constants
// here), so ZIMRA or NSSA changing a rate is a settings change. Money is whole cents; rates are basis points (450 = 4.5%).
// Each currency is calculated on its own with its own tables; nothing here adds USD to ZiG.
import type { Cur } from '@/lib/finance/money';

export type { Cur };

/** One slice of a PAYE table: income from `fromCents` upward is taxed at `rateBps` until the next band starts. */
export interface TaxBand { fromCents: number; rateBps: number }

export interface StatutoryRates {
  /** PAYE bands for this currency, monthly. */
  bands: TaxBand[];
  /** AIDS levy as basis points of the PAYE. */
  aidsLevyBps: number;
  nssaEmployeeBps: number;
  nssaEmployerBps: number;
  /** NSSA is charged on earnings up to this monthly ceiling (null = no ceiling). */
  nssaCeilingCents: number | null;
  /** When true the employee's NSSA is taken off before PAYE is worked out. The school's accountant decides. */
  nssaDeductibleBeforePaye: boolean;
  /** ZIMDEF, employer-only, as basis points of the wage bill (gross). */
  zimdefBps: number;
}

export interface EarningLine { code: string; label: string; amountCents: number; taxable: boolean }
export interface DeductionLine { code: string; label: string; amountCents: number }

export interface PayInput {
  currency: Cur;
  earnings: EarningLine[];
  /** Other deductions (union dues, pension, loan instalments ...): taken after tax, they do not change PAYE. */
  deductions: DeductionLine[];
}

export interface PayResult {
  currency: Cur;
  grossCents: number;
  taxableCents: number;
  insurableCents: number;
  payeCents: number;
  aidsLevyCents: number;
  nssaEmployeeCents: number;
  nssaEmployerCents: number;
  zimdefCents: number;
  otherDeductionsCents: number;
  /** Can be negative when deductions exceed pay; the run flags it and the caller decides. */
  netCents: number;
  /** Gross plus the employer's NSSA and ZIMDEF. */
  costToSchoolCents: number;
}

/** bps of an amount, rounded half up to the cent. */
export function bpsOf(amountCents: number, bps: number): number {
  if (amountCents <= 0 || bps <= 0) return 0;
  return Math.floor((amountCents * bps + 5000) / 10000);
}

/** Checks a table is usable: starts at 0, rises, rates 0-100%. Settings screens call this before saving. */
export function assertValidBands(bands: TaxBand[]): void {
  if (bands.length === 0) throw new RangeError('A tax table needs at least one band');
  if (bands[0]!.fromCents !== 0) throw new RangeError('The first band must start at 0');
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i]!;
    if (!Number.isInteger(b.fromCents) || b.fromCents < 0) throw new RangeError('Band limits are whole cents');
    if (!Number.isInteger(b.rateBps) || b.rateBps < 0 || b.rateBps > 10000) throw new RangeError('A band rate must be between 0% and 100%');
    if (i > 0 && b.fromCents <= bands[i - 1]!.fromCents) throw new RangeError('Band limits must rise');
  }
}

/** Progressive tax: each slice of income is taxed at its own band's rate. Each band's slice is rounded once, half up. */
export function calcPaye(taxableCents: number, bands: TaxBand[]): number {
  if (taxableCents <= 0) return 0;
  const sorted = [...bands].sort((a, b) => a.fromCents - b.fromCents);
  let tax = 0;
  for (let i = 0; i < sorted.length; i++) {
    const lo = sorted[i]!.fromCents;
    const hi = i + 1 < sorted.length ? sorted[i + 1]!.fromCents : Infinity;
    if (taxableCents <= lo) break;
    tax += bpsOf(Math.min(taxableCents, hi) - lo, sorted[i]!.rateBps);
  }
  return tax;
}

export function calcPay(input: PayInput, rates: StatutoryRates): PayResult {
  const sum = (xs: { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);
  for (const l of [...input.earnings, ...input.deductions]) {
    if (!Number.isInteger(l.amountCents) || l.amountCents < 0) throw new RangeError(`${l.label}: amounts are whole, non-negative cents`);
  }
  const grossCents = sum(input.earnings);
  const insurableCents = rates.nssaCeilingCents == null ? grossCents : Math.min(grossCents, rates.nssaCeilingCents);
  const nssaEmployeeCents = bpsOf(insurableCents, rates.nssaEmployeeBps);
  const nssaEmployerCents = bpsOf(insurableCents, rates.nssaEmployerBps);
  const taxableGross = sum(input.earnings.filter((e) => e.taxable));
  const taxableCents = Math.max(0, rates.nssaDeductibleBeforePaye ? taxableGross - nssaEmployeeCents : taxableGross);
  const payeCents = calcPaye(taxableCents, rates.bands);
  const aidsLevyCents = bpsOf(payeCents, rates.aidsLevyBps);
  const zimdefCents = bpsOf(grossCents, rates.zimdefBps);
  const otherDeductionsCents = sum(input.deductions);
  const netCents = grossCents - payeCents - aidsLevyCents - nssaEmployeeCents - otherDeductionsCents;
  return {
    currency: input.currency, grossCents, taxableCents, insurableCents, payeCents, aidsLevyCents, nssaEmployeeCents, nssaEmployerCents, zimdefCents,
    otherDeductionsCents, netCents, costToSchoolCents: grossCents + nssaEmployerCents + zimdefCents,
  };
}

/** A part-month: `daysPaid` of `daysInPeriod`, rounded half up. A full month returns the amount unchanged. */
export function prorate(amountCents: number, daysPaid: number, daysInPeriod: number): number {
  if (daysInPeriod <= 0) throw new RangeError('A period has at least one day');
  const d = Math.max(0, Math.min(daysPaid, daysInPeriod));
  if (d === daysInPeriod) return amountCents;
  return Math.floor((amountCents * d * 2 + daysInPeriod) / (daysInPeriod * 2));
}

/** Casual and hourly staff: units worked (days or hours, in hundredths allowed as a number of tenths) times the rate. */
export function casualPay(unitsWorked: number, rateCents: number): number {
  if (unitsWorked < 0 || rateCents < 0) throw new RangeError('Units and rate cannot be negative');
  return Math.round(unitsWorked * rateCents);
}

/** Unpaid leave: the daily rate is the monthly pay over the days in the month, taken off for each unpaid day. */
export function unpaidLeaveDeduction(monthlyCents: number, unpaidDays: number, daysInPeriod: number): number {
  return monthlyCents - prorate(monthlyCents, Math.max(0, daysInPeriod - unpaidDays), daysInPeriod);
}

/** Net pay that moved more than `thresholdPct` from last month (either way). First-ever pay (no previous) is not flagged. */
export function netMovedFlag(previousNetCents: number | null | undefined, netCents: number, thresholdPct = 10): { flagged: boolean; changePct: number | null } {
  if (previousNetCents == null) return { flagged: false, changePct: null };
  if (previousNetCents === 0) return { flagged: netCents !== 0, changePct: null };
  const changePct = ((netCents - previousNetCents) / previousNetCents) * 100;
  return { flagged: Math.abs(changePct) > thresholdPct, changePct: Math.round(changePct * 10) / 10 };
}

/**
 * Splits a basic pay into currencies by a rule (e.g. 70% USD, 30% ZiG at the payroll rate). `usdBps` is the USD share;
 * `zigPerUsd` is the payroll rate in ZiG per US$1 (as hundredths, so 27.50 is 2750). The ZiG part is the USD value of the
 * ZiG share converted at that rate.
 */
export function splitPay(totalUsdCents: number, usdBps: number, zigPerUsdHundredths: number): { USD: number; ZIG: number } {
  if (usdBps < 0 || usdBps > 10000) throw new RangeError('The USD share is between 0% and 100%');
  const usd = bpsOf(totalUsdCents, usdBps);
  const zigShareUsd = totalUsdCents - usd;
  return { USD: usd, ZIG: Math.floor((zigShareUsd * zigPerUsdHundredths + 50) / 100) };
}

// Straight-line depreciation and the dates of recurring service. Pure, so the register, the reports and the tests agree.

const DAY = 86_400_000;

/**
 * Book value in cents: cost less an equal share for every year of the category's life that has gone, never below zero.
 * No life (null) means the asset is not depreciated. `from` is the purchase date.
 */
export function bookValueCents(costCents: number, from: Date | null, lifeYears: number | null, asOf: Date = new Date()): number {
  if (!lifeYears || lifeYears <= 0 || !from) return costCents;
  const years = Math.max(0, (asOf.getTime() - from.getTime()) / (365.25 * DAY));
  return Math.max(0, Math.round(costCents * (1 - years / lifeYears)));
}

/** Depreciation so far, in cents. */
export const depreciationCents = (costCents: number, from: Date | null, lifeYears: number | null, asOf: Date = new Date()) => costCents - bookValueCents(costCents, from, lifeYears, asOf);

/** The date `months` months after `from` (YYYY-MM-DD), keeping the day of the month where the month is long enough. */
export function addMonths(from: string, months: number): string {
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  const total = (m - 1) + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export interface Due { dueAt: string | null; dueKm: number | null }

/** When a recurring service is next due, from when it was last done (or when it was set up) and, for vehicles, the odometer then. */
export function nextDue(rule: { everyMonths: number | null; everyKm: number | null }, last: { date: string; km: number | null }): Due {
  return {
    dueAt: rule.everyMonths ? addMonths(last.date, rule.everyMonths) : null,
    dueKm: rule.everyKm && last.km !== null ? last.km + rule.everyKm : null,
  };
}

/** Is a service due soon (the reminder time before the date, or within 500 km of the odometer reading)? */
export function dueSoon(due: Due, today: string, remindDays: number, odometerKm: number | null): { byDate: boolean; byKm: boolean; overdue: boolean } {
  const limit = new Date(`${today}T00:00:00Z`).getTime() + remindDays * DAY;
  const byDate = !!due.dueAt && new Date(`${due.dueAt}T00:00:00Z`).getTime() <= limit;
  const byKm = due.dueKm !== null && odometerKm !== null && odometerKm >= due.dueKm - 500;
  const overdue = (!!due.dueAt && due.dueAt < today) || (due.dueKm !== null && odometerKm !== null && odometerKm >= due.dueKm);
  return { byDate, byKm, overdue };
}

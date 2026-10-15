// Repeating events. Only the first occurrence is stored; the others are worked out when
// a range is shown. All dates are "YYYY-MM-DD" strings handled in UTC.

export type Repeat = 'NONE' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface Recurring {
  startDate: string;
  endDate: string;
  repeat: Repeat;
  repeatUntil: string | null;
}

export interface Occurrence { startDate: string; endDate: string; index: number }

/** Safety cap: a weekly event over five years is about 260 occurrences. */
export const MAX_OCCURRENCES = 800;

const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 864e5;

export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / DAY);
export const addDaysIso = (s: string, n: number) => fmt(new Date(parse(s).getTime() + n * DAY));

function daysInMonth(y: number, m0: number) {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** The start of occurrence n. Monthly and yearly keep the original day-of-month, clamped to short months. */
export function occurrenceStart(startDate: string, repeat: Repeat, n: number): string {
  if (repeat === 'NONE' || n === 0) return startDate;
  if (repeat === 'WEEKLY') return addDaysIso(startDate, 7 * n);
  const d = parse(startDate);
  const monthsToAdd = repeat === 'MONTHLY' ? n : 12 * n;
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + monthsToAdd;
  const y = Math.floor(total / 12);
  const m0 = total % 12;
  return fmt(new Date(Date.UTC(y, m0, Math.min(d.getUTCDate(), daysInMonth(y, m0)))));
}

/** Occurrences that touch [from, to], in order. A span keeps its length in every occurrence. */
export function expand(ev: Recurring, from: string, to: string): Occurrence[] {
  const length = daysBetween(ev.startDate, ev.endDate);
  const out: Occurrence[] = [];
  for (let n = 0; n < MAX_OCCURRENCES; n++) {
    const start = occurrenceStart(ev.startDate, ev.repeat, n);
    if (ev.repeat !== 'NONE' && (!ev.repeatUntil || start > ev.repeatUntil)) break;
    if (start > to) break;
    const end = addDaysIso(start, length);
    if (end >= from) out.push({ startDate: start, endDate: end, index: n });
    if (ev.repeat === 'NONE') break;
  }
  return out;
}

/** Every occurrence, for checks that need the whole series. */
export function allOccurrences(ev: Recurring): Occurrence[] {
  return expand(ev, '0000-01-01', '9999-12-31');
}

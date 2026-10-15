// Date arithmetic for the month / week / list views. Weeks start on Monday.
import { addDaysIso } from '@/lib/system/recurrence';

export type CalendarView = 'month' | 'week' | 'list';

const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export const isIsoDate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(parse(s)) === s;

/** Monday on or before the date. */
export function weekStart(date: string): string {
  const dow = (parse(date).getUTCDay() + 6) % 7; // Monday = 0
  return addDaysIso(date, -dow);
}

export function weekDays(date: string): string[] {
  const start = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
}

/** The weeks shown for the month containing `date`, padded with days of the neighbouring months. */
export function monthGrid(date: string): string[][] {
  const first = `${date.slice(0, 7)}-01`;
  const lastDay = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
  const last = `${date.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`;
  const weeks: string[][] = [];
  for (let s = weekStart(first); s <= last; s = addDaysIso(s, 7)) weeks.push(weekDays(s));
  return weeks;
}

/** The first and last day a view needs events for. */
export function viewRange(view: CalendarView, date: string): { from: string; to: string } {
  if (view === 'week') {
    const days = weekDays(date);
    return { from: days[0], to: days[6] };
  }
  if (view === 'list') {
    const lastDay = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
    return { from: `${date.slice(0, 7)}-01`, to: `${date.slice(0, 7)}-${String(lastDay).padStart(2, '0')}` };
  }
  const grid = monthGrid(date);
  return { from: grid[0][0], to: grid[grid.length - 1][6] };
}

/** Previous / next page for a view: a month, a week, or a month. */
export function shiftDate(view: CalendarView, date: string, direction: -1 | 1): string {
  if (view === 'week') return addDaysIso(date, 7 * direction);
  const y = Number(date.slice(0, 4));
  const m0 = Number(date.slice(5, 7)) - 1 + direction;
  const year = y + Math.floor(m0 / 12);
  const month = ((m0 % 12) + 12) % 12;
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

export const onDay = (item: { startDate: string; endDate: string }, day: string) => item.startDate <= day && item.endDate >= day;

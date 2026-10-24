// Which days staff are expected at school: a weekday the school works, inside a term, and not a public holiday on the Calendar. Leave is
// counted in these days, the staff register exists on these days, and casual pay is worked out from them.
import type { Db } from '@/lib/scoped-db';
import { addDays, isoOf, weekdayOf } from '@/lib/academics/common';
import { loadHrSettings } from '@/lib/hr/common';

export interface WorkCalendar {
  isWorkingDay(date: string): boolean;
  /** Working days from `from` to `to`, both included. */
  days(from: string, to: string): string[];
  holidayName(date: string): string | null;
}

/** Loads the terms and public holidays that touch [from, to] once, so a loop over many days does not hit the database each time. */
export async function workCalendar(tx: Db, schoolId: string, from: string, to: string): Promise<WorkCalendar> {
  const [terms, events, settings] = await Promise.all([
    tx.academicTerm.findMany({ where: { schoolId, startDate: { lte: new Date(`${to}T00:00:00Z`) }, endDate: { gte: new Date(`${from}T00:00:00Z`) } }, select: { startDate: true, endDate: true } }),
    tx.calendarEvent.findMany({ where: { schoolId, kind: 'PUBLIC_HOLIDAY', startDate: { lte: new Date(`${to}T00:00:00Z`) }, endDate: { gte: new Date(`${from}T00:00:00Z`) } }, select: { title: true, startDate: true, endDate: true } }),
    loadHrSettings(tx, schoolId),
  ]);
  const holidays = new Map<string, string>();
  for (const e of events) for (let d = isoOf(e.startDate); d <= isoOf(e.endDate); d = addDays(d, 1)) holidays.set(d, e.title);
  const inTerm = (d: string) => terms.some((t) => isoOf(t.startDate) <= d && d <= isoOf(t.endDate));
  const isWorkingDay = (d: string) => settings.workingWeekdays.includes(weekdayOf(d)) && inTerm(d) && !holidays.has(d);
  return {
    isWorkingDay,
    holidayName: (d) => holidays.get(d) ?? null,
    days: (a, b) => {
      const out: string[] = [];
      for (let d = a; d <= b; d = addDays(d, 1)) if (isWorkingDay(d)) out.push(d);
      return out;
    },
  };
}

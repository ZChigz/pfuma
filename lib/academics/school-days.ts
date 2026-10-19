// Which days are school days. Weekends, public holidays and days outside the term have no register and no lessons;
// Saturday counts only when the school's bell schedule has lessons on Saturday. The calendar (Dashboard & System) is the
// one place holidays live; term dates come from the terms.
import type { AcademicTerm } from '@prisma/client';
import type { Db, ScopedDb } from '@/lib/scoped-db';
import { listCalendar } from '@/lib/system/calendar';
import { addDays, isoOf, weekdayOf, type Actor } from '@/lib/academics/common';

export type NoSchoolReason = 'WEEKEND' | 'HOLIDAY' | 'OUTSIDE_TERM';
export interface DayInfo { date: string; isSchoolDay: boolean; reason: NoSchoolReason | null; holidayName: string | null; term: Pick<AcademicTerm, 'id' | 'name' | 'status'> | null }

type TermLike = Pick<AcademicTerm, 'id' | 'name' | 'status' | 'startDate' | 'endDate'>;

/** Pure rule: is `date` a school day, given the terms, the holidays and whether Saturday is taught? */
export function dayInfo(date: string, terms: TermLike[], holidays: Map<string, string>, saturday: boolean): DayInfo {
  const term = terms.find((t) => isoOf(t.startDate) <= date && date <= isoOf(t.endDate)) ?? null;
  const t = term ? { id: term.id, name: term.name, status: term.status } : null;
  const wd = weekdayOf(date);
  if (!term) return { date, isSchoolDay: false, reason: 'OUTSIDE_TERM', holidayName: null, term: null };
  if (wd === 7 || (wd === 6 && !saturday)) return { date, isSchoolDay: false, reason: 'WEEKEND', holidayName: null, term: t };
  if (holidays.has(date)) return { date, isSchoolDay: false, reason: 'HOLIDAY', holidayName: holidays.get(date)!, term: t };
  return { date, isSchoolDay: true, reason: null, holidayName: null, term: t };
}

export const NO_SCHOOL_TEXT: Record<NoSchoolReason, string> = {
  WEEKEND: 'There is no school on this day (weekend).',
  HOLIDAY: 'There is no school on this day (public holiday).',
  OUTSIDE_TERM: 'This day is outside the term, so there is no register.',
};

/** Public holidays between two days, by date (a holiday that lasts several days appears on each of them). */
export async function holidayMap(db: ScopedDb, actor: Actor, from: string, to: string): Promise<Map<string, string>> {
  const items = await listCalendar(db, actor, from, to, { type: 'PUBLIC_HOLIDAY' });
  const out = new Map<string, string>();
  for (const i of items) {
    for (let d = i.startDate < from ? from : i.startDate; d <= i.endDate && d <= to; d = addDays(d, 1)) out.set(d, i.title);
  }
  return out;
}

/** Whether the bell schedule that applies to the term has lessons on Saturday. No schedule yet means Monday to Friday. */
export async function teachesSaturday(db: Pick<Db, 'bellSchedule' | 'period'>, termId: string | null): Promise<boolean> {
  const schedules = await db.bellSchedule.findMany({ where: { OR: [{ termId }, { termId: null }] }, select: { id: true, termId: true } });
  const chosen = schedules.find((s) => s.termId === termId && termId) ?? schedules.find((s) => s.termId === null);
  if (!chosen) return false;
  return (await db.period.count({ where: { scheduleId: chosen.id, dayOfWeek: 6, type: 'LESSON' } })) > 0;
}

export async function schoolDayInfo(db: ScopedDb, actor: Actor, date: string): Promise<DayInfo> {
  const terms = await db.academicTerm.findMany({ where: { schoolId: actor.schoolId }, select: { id: true, name: true, status: true, startDate: true, endDate: true } });
  const term = terms.find((t) => isoOf(t.startDate) <= date && date <= isoOf(t.endDate)) ?? null;
  const [holidays, saturday] = await Promise.all([holidayMap(db, actor, date, date), teachesSaturday(db as unknown as Db, term?.id ?? null)]);
  return dayInfo(date, terms, holidays, saturday);
}

/** Every school day of a term (or the part of it between `from` and `to`). */
export async function schoolDaysOf(db: ScopedDb, actor: Actor, term: TermLike, range: { from?: string; to?: string } = {}): Promise<string[]> {
  const start = range.from && range.from > isoOf(term.startDate) ? range.from : isoOf(term.startDate);
  const end = range.to && range.to < isoOf(term.endDate) ? range.to : isoOf(term.endDate);
  if (start > end) return [];
  const [holidays, saturday] = await Promise.all([holidayMap(db, actor, start, end), teachesSaturday(db as unknown as Db, term.id)]);
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (dayInfo(d, [term], holidays, saturday).isSchoolDay) out.push(d);
  return out;
}

export interface TermWeek { weekNo: number; startDate: string; endDate: string; schoolDays: number }

/** The teaching weeks of a term, Monday to Sunday, leaving out weeks with no school day (a holiday week). */
export function termWeeks(term: TermLike, holidays: Map<string, string>, saturday: boolean): TermWeek[] {
  const start = isoOf(term.startDate), end = isoOf(term.endDate);
  let monday = addDays(start, -(weekdayOf(start) - 1));
  const out: TermWeek[] = [];
  for (; monday <= end; monday = addDays(monday, 7)) {
    let days = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      if (d >= start && d <= end && dayInfo(d, [term], holidays, saturday).isSchoolDay) days++;
    }
    if (days > 0) out.push({ weekNo: out.length + 1, startDate: monday < start ? start : monday, endDate: addDays(monday, 6) > end ? end : addDays(monday, 6), schoolDays: days });
  }
  return out;
}

export async function weeksOfTerm(db: ScopedDb, actor: Actor, term: TermLike): Promise<TermWeek[]> {
  const [holidays, saturday] = await Promise.all([holidayMap(db, actor, isoOf(term.startDate), isoOf(term.endDate)), teachesSaturday(db as unknown as Db, term.id)]);
  return termWeeks(term, holidays, saturday);
}

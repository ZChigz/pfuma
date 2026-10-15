import { describe, expect, it } from 'vitest';
import { easterSunday, nthWeekday, zimbabweHolidays } from '@/lib/system/holidays';
import { allOccurrences, expand, occurrenceStart, MAX_OCCURRENCES } from '@/lib/system/recurrence';
import { monthGrid, shiftDate, viewRange, weekDays, weekStart, isIsoDate } from '@/lib/system/calendar-grid';
import { KIND_INFO, KIND_ORDER, rangeText, timeText } from '@/lib/system/calendar-types';
import { CalendarEventSchema } from '@/lib/validations/system';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const byKey = (year: number) => Object.fromEntries(zimbabweHolidays(year).map((h) => [h.key, h.date]));

describe('Easter', () => {
  it('matches the known dates', () => {
    expect(iso(easterSunday(2024))).toBe('2024-03-31');
    expect(iso(easterSunday(2025))).toBe('2025-04-20');
    expect(iso(easterSunday(2026))).toBe('2026-04-05');
    expect(iso(easterSunday(2027))).toBe('2027-03-28');
    expect(iso(easterSunday(2030))).toBe('2030-04-21');
  });
  it('finds the n-th weekday of a month', () => {
    expect(iso(nthWeekday(2026, 8, 1, 2))).toBe('2026-08-10'); // second Monday of August 2026
    expect(iso(nthWeekday(2027, 8, 1, 2))).toBe('2027-08-09'); // August 2027 starts on a Sunday
  });
});

describe('Zimbabwe public holidays', () => {
  it('lists the thirteen holidays for 2026', () => {
    const h = byKey(2026);
    expect(Object.keys(h)).toHaveLength(13);
    expect(h).toMatchObject({
      NEW_YEARS_DAY: '2026-01-01', YOUTH_DAY: '2026-02-21', GOOD_FRIDAY: '2026-04-03', EASTER_SATURDAY: '2026-04-04', EASTER_MONDAY: '2026-04-06',
      INDEPENDENCE_DAY: '2026-04-18', WORKERS_DAY: '2026-05-01', AFRICA_DAY: '2026-05-25', HEROES_DAY: '2026-08-10', DEFENCE_FORCES_DAY: '2026-08-11',
      UNITY_DAY: '2026-12-22', CHRISTMAS_DAY: '2026-12-25', BOXING_DAY: '2026-12-26',
    });
  });

  it('names them as the school knows them', () => {
    const names = zimbabweHolidays(2026).map((h) => h.name);
    for (const n of ["New Year's Day", 'Robert Gabriel Mugabe National Youth Day', 'Good Friday', 'Easter Saturday', 'Easter Monday', 'Independence Day',
      "Workers' Day", 'Africa Day', "Heroes' Day", 'Defence Forces Day', 'Unity Day', 'Christmas Day', 'Boxing Day']) expect(names).toContain(n);
  });

  it('moves a holiday that falls on a Sunday to the Monday', () => {
    const h = byKey(2027); // 21 Feb and 18 Apr 2027 are Sundays
    expect(h.YOUTH_DAY).toBe('2027-02-22');
    expect(h.INDEPENDENCE_DAY).toBe('2027-04-19');
    expect(h.BOXING_DAY).toBe('2027-12-27'); // 26 Dec 2027 is a Sunday
    expect(h.HEROES_DAY).toBe('2027-08-09');
    expect(h.DEFENCE_FORCES_DAY).toBe('2027-08-10');
  });

  it('never puts two holidays on one day or any holiday on a Sunday', () => {
    for (let year = 2024; year <= 2040; year++) {
      const days = zimbabweHolidays(year).map((h) => h.date);
      expect(new Set(days).size, String(year)).toBe(days.length);
      for (const d of days) expect(new Date(`${d}T00:00:00Z`).getUTCDay(), d).not.toBe(0);
    }
  });

  it('gives a moved Christmas and Boxing Day their own days (Christmas on a Sunday, 2022)', () => {
    const h = byKey(2022);
    expect(h.CHRISTMAS_DAY).toBe('2022-12-26');
    expect(h.BOXING_DAY).toBe('2022-12-27');
  });
});

describe('repeats', () => {
  const ev = (over: object) => ({ startDate: '2026-03-02', endDate: '2026-03-02', repeat: 'WEEKLY' as const, repeatUntil: '2026-03-23', ...over });

  it('does not repeat when asked not to', () => {
    expect(expand({ ...ev({}), repeat: 'NONE', repeatUntil: null }, '2026-01-01', '2026-12-31').map((o) => o.startDate)).toEqual(['2026-03-02']);
  });
  it('repeats weekly up to and including the last allowed start', () => {
    expect(allOccurrences(ev({})).map((o) => o.startDate)).toEqual(['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23']);
    expect(allOccurrences(ev({ repeatUntil: '2026-03-22' })).map((o) => o.startDate)).toEqual(['2026-03-02', '2026-03-09', '2026-03-16']);
  });
  it('keeps the length of a multi-day event in every occurrence', () => {
    const o = allOccurrences(ev({ endDate: '2026-03-04' }));
    expect(o.map((x) => `${x.startDate}..${x.endDate}`)).toEqual(['2026-03-02..2026-03-04', '2026-03-09..2026-03-11', '2026-03-16..2026-03-18', '2026-03-23..2026-03-25']);
  });
  it('only returns occurrences that touch the range asked for', () => {
    expect(expand(ev({}), '2026-03-10', '2026-03-16').map((o) => o.startDate)).toEqual(['2026-03-16']);
    expect(expand(ev({ endDate: '2026-03-04' }), '2026-03-10', '2026-03-10').map((o) => o.startDate)).toEqual(['2026-03-09']); // still going on the 10th
    expect(expand(ev({}), '2027-01-01', '2027-12-31')).toEqual([]);
  });
  it('repeats monthly on the same day, clamped in short months and restored after', () => {
    const m = (n: number) => occurrenceStart('2026-01-31', 'MONTHLY', n);
    expect([0, 1, 2, 3, 12].map(m)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2027-01-31']);
  });
  it('repeats yearly, with 29 February falling back to 28 February', () => {
    const y = (n: number) => occurrenceStart('2028-02-29', 'YEARLY', n);
    expect([0, 1, 2, 3, 4].map(y)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });
  it('stops at a safety cap', () => {
    expect(allOccurrences({ startDate: '2026-01-01', endDate: '2026-01-01', repeat: 'WEEKLY', repeatUntil: '9999-01-01' }).length).toBe(MAX_OCCURRENCES);
  });
  it('treats a repeat with no end date as not repeating further', () => {
    expect(allOccurrences({ startDate: '2026-01-01', endDate: '2026-01-01', repeat: 'WEEKLY', repeatUntil: null })).toEqual([]);
  });
});

describe('calendar grid', () => {
  it('starts weeks on Monday', () => {
    expect(weekStart('2026-08-12')).toBe('2026-08-10');
    expect(weekStart('2026-08-16')).toBe('2026-08-10'); // Sunday
    expect(weekStart('2026-08-10')).toBe('2026-08-10');
    expect(weekDays('2026-08-12')).toEqual(['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16']);
  });
  it('lays a month out in whole weeks that contain it', () => {
    const g = monthGrid('2026-08-15');
    expect(g[0][0]).toBe('2026-07-27');
    expect(g[g.length - 1][6]).toBe('2026-09-06');
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g.flat()).toContain('2026-08-01');
    expect(g.flat()).toContain('2026-08-31');
    expect(monthGrid('2027-02-10')).toHaveLength(4); // February 2027 is exactly four Monday-to-Sunday weeks
  });
  it('gives the range each view needs', () => {
    expect(viewRange('week', '2026-08-12')).toEqual({ from: '2026-08-10', to: '2026-08-16' });
    expect(viewRange('list', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(viewRange('month', '2026-08-15')).toEqual({ from: '2026-07-27', to: '2026-09-06' });
  });
  it('moves a month or a week at a time, across year ends', () => {
    expect(shiftDate('month', '2026-12-15', 1)).toBe('2027-01-01');
    expect(shiftDate('month', '2026-01-15', -1)).toBe('2025-12-01');
    expect(shiftDate('week', '2026-08-12', 1)).toBe('2026-08-19');
  });
  it('knows a real date from a fake one', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('26-02-28')).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });
});

describe('event types and text', () => {
  it('gives every type its own colour and a name', () => {
    expect(KIND_ORDER).toHaveLength(9);
    expect(new Set(KIND_ORDER.map((k) => KIND_INFO[k].color)).size).toBe(9);
    expect(KIND_ORDER.map((k) => KIND_INFO[k].label)).toEqual(['Term date', 'Public holiday', 'Exam', 'Meeting', 'Sports', 'Cultural', 'Visiting day', 'Prize giving', 'Other']);
  });
  it('writes times and ranges', () => {
    expect(timeText({ allDay: true, startTime: null, endTime: null })).toBe('All day');
    expect(timeText({ allDay: false, startTime: '08:00', endTime: '10:30' })).toBe('08:00 to 10:30');
    expect(rangeText('2026-08-10', '2026-08-10')).toBe('10 Aug 2026');
    expect(rangeText('2026-08-10', '2026-08-11')).toBe('10 Aug 2026 to 11 Aug 2026');
  });
});

describe('event rules (Zod)', () => {
  const ok = { title: 'Sports day', kind: 'SPORTS', startDate: '2026-06-10', endDate: '2026-06-10' };
  const bad = (over: object) => CalendarEventSchema.safeParse({ ...ok, ...over }).success;

  it('accepts a minimal event and fills the defaults', () => {
    expect(CalendarEventSchema.parse(ok)).toMatchObject({ allDay: true, audience: 'ALL_STAFF', repeat: 'NONE', startTime: null, endTime: null, audienceLevelIds: [], repeatUntil: null });
  });
  it('limits the title to 120 characters and requires one', () => {
    expect(bad({ title: 'x'.repeat(120) })).toBe(true);
    expect(bad({ title: 'x'.repeat(121) })).toBe(false);
    expect(bad({ title: '   ' })).toBe(false);
  });
  it('accepts exactly the listed types', () => {
    for (const k of ['PUBLIC_HOLIDAY', 'EXAM', 'MEETING', 'SPORTS', 'CULTURAL', 'VISITING_DAY', 'PRIZE_GIVING', 'OTHER']) expect(bad({ kind: k }), k).toBe(true);
    for (const k of ['TERM', 'HOLIDAY', 'PARTY', '']) expect(bad({ kind: k }), k).toBe(false);
  });
  it('needs the end on or after the start', () => {
    expect(bad({ endDate: '2026-06-09' })).toBe(false);
    expect(bad({ endDate: '2026-06-11' })).toBe(true);
  });
  it('needs times unless the event is all day, and an end time that is not before the start on a one-day event', () => {
    expect(bad({ allDay: false })).toBe(false);
    expect(bad({ allDay: false, startTime: '08:00' })).toBe(false);
    expect(bad({ allDay: false, startTime: '10:00', endTime: '08:00' })).toBe(false);
    expect(bad({ allDay: false, startTime: '08:00', endTime: '10:30' })).toBe(true);
    expect(bad({ allDay: false, startTime: '22:00', endTime: '06:00', endDate: '2026-06-11' })).toBe(true); // overnight across two days
    expect(bad({ allDay: false, startTime: '8am', endTime: '10:30' })).toBe(false);
    expect(bad({ allDay: false, startTime: '24:00', endTime: '25:00' })).toBe(false);
  });
  it('drops times when the event is all day', () => {
    expect(CalendarEventSchema.parse({ ...ok, allDay: true, startTime: '08:00', endTime: '09:00' })).toMatchObject({ startTime: null, endTime: null });
  });
  it('needs forms or classes when the audience names them, and ignores ids that do not belong', () => {
    expect(bad({ audience: 'FORMS' })).toBe(false);
    expect(bad({ audience: 'FORMS', audienceLevelIds: ['a'] })).toBe(true);
    expect(bad({ audience: 'CLASSES', audienceClassIds: [] })).toBe(false);
    expect(bad({ audience: 'CLASSES', audienceClassIds: ['c'] })).toBe(true);
    expect(bad({ audience: 'BOARDERS' })).toBe(true);
    expect(CalendarEventSchema.parse({ ...ok, audience: 'BOARDERS', audienceLevelIds: ['a'], audienceClassIds: ['c'] })).toMatchObject({ audienceLevelIds: [], audienceClassIds: [] });
    expect(CalendarEventSchema.parse({ ...ok, audience: 'FORMS', audienceLevelIds: ['a', 'a', 'b'] }).audienceLevelIds).toEqual(['a', 'b']);
    expect(bad({ audience: 'EVERYONE' })).toBe(false);
  });
  it('needs an end date for repeats, not before the start and within five years', () => {
    expect(bad({ repeat: 'WEEKLY' })).toBe(false);
    expect(bad({ repeat: 'WEEKLY', repeatUntil: '2026-06-09' })).toBe(false);
    expect(bad({ repeat: 'WEEKLY', repeatUntil: '2026-12-01' })).toBe(true);
    expect(bad({ repeat: 'YEARLY', repeatUntil: '2031-06-10' })).toBe(true);
    expect(bad({ repeat: 'YEARLY', repeatUntil: '2031-06-11' })).toBe(false);
    expect(bad({ repeat: 'DAILY', repeatUntil: '2026-12-01' })).toBe(false);
    expect(CalendarEventSchema.parse({ ...ok, repeat: 'NONE', repeatUntil: '2026-12-01' }).repeatUntil).toBeNull();
  });
  it('keeps location and description within their limits', () => {
    expect(bad({ location: 'x'.repeat(121) })).toBe(false);
    expect(bad({ notes: 'x'.repeat(1001) })).toBe(false);
    expect(bad({ location: 'Main hall', notes: 'Bring water' })).toBe(true);
  });
});

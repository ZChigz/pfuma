// Zimbabwe public holidays for a year. Pure date arithmetic on "YYYY-MM-DD" strings (UTC),
// so there are no time-zone surprises.

export interface Holiday { key: string; name: string; date: string }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);

/** Easter Sunday (Gregorian calendar, the anonymous "computus" algorithm). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/** The n-th (1-based) given weekday (0 = Sunday … 6 = Saturday) of a month. */
export function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = utc(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utc(year, month, 1 + offset + (n - 1) * 7);
}

export function zimbabweHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const heroes = nthWeekday(year, 8, 1, 2); // second Monday of August

  // Fixed-date holidays: one that falls on a Sunday moves to the Monday.
  const fixed: { key: string; name: string; m: number; d: number }[] = [
    { key: 'NEW_YEARS_DAY', name: "New Year's Day", m: 1, d: 1 },
    { key: 'YOUTH_DAY', name: 'Robert Gabriel Mugabe National Youth Day', m: 2, d: 21 },
    { key: 'INDEPENDENCE_DAY', name: 'Independence Day', m: 4, d: 18 },
    { key: 'WORKERS_DAY', name: "Workers' Day", m: 5, d: 1 },
    { key: 'AFRICA_DAY', name: 'Africa Day', m: 5, d: 25 },
    { key: 'UNITY_DAY', name: 'Unity Day', m: 12, d: 22 },
    { key: 'CHRISTMAS_DAY', name: 'Christmas Day', m: 12, d: 25 },
    { key: 'BOXING_DAY', name: 'Boxing Day', m: 12, d: 26 },
  ];
  // Easter and Heroes' weekends are never on a Sunday, so they never move.
  const moving: Holiday[] = [
    { key: 'GOOD_FRIDAY', name: 'Good Friday', date: iso(addDays(easter, -2)) },
    { key: 'EASTER_SATURDAY', name: 'Easter Saturday', date: iso(addDays(easter, -1)) },
    { key: 'EASTER_MONDAY', name: 'Easter Monday', date: iso(addDays(easter, 1)) },
    { key: 'HEROES_DAY', name: "Heroes' Day", date: iso(heroes) },
    { key: 'DEFENCE_FORCES_DAY', name: 'Defence Forces Day', date: iso(addDays(heroes, 1)) },
  ];

  const taken = new Set(moving.map((h) => h.date));
  const result: Holiday[] = [...moving];
  // Earlier dates claim their day first, so a moved holiday takes the next free day.
  const sortedFixed = fixed
    .map((f) => ({ ...f, date: utc(year, f.m, f.d) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const f of sortedFixed) {
    let day = f.date;
    if (day.getUTCDay() === 0) day = addDays(day, 1);
    while (taken.has(iso(day)) || day.getUTCDay() === 0) day = addDays(day, 1);
    taken.add(iso(day));
    result.push({ key: f.key, name: f.name, date: iso(day) });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

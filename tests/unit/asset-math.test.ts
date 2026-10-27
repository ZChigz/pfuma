import { describe, expect, it } from 'vitest';
import { addMonths, bookValueCents, depreciationCents, dueSoon, nextDue } from '@/lib/facilities/asset-math';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('straight-line depreciation', () => {
  it('takes an equal share off for every year of the category\'s life', () => {
    expect(bookValueCents(90_000, d('2026-01-01'), 3, d('2027-01-01'))).toBeCloseTo(60_000, -2);
    expect(bookValueCents(90_000, d('2026-01-01'), 3, d('2028-07-01'))).toBeCloseTo(15_000, -3);
  });

  it('never goes below zero, and nothing is taken off before the purchase date or for a category with no life', () => {
    expect(bookValueCents(90_000, d('2020-01-01'), 3, d('2026-10-01'))).toBe(0);
    expect(bookValueCents(90_000, d('2027-01-01'), 3, d('2026-10-01'))).toBe(90_000);
    expect(bookValueCents(90_000, d('2020-01-01'), null, d('2026-10-01'))).toBe(90_000);
    expect(bookValueCents(90_000, null, 3, d('2026-10-01'))).toBe(90_000);
  });

  it('book value and depreciation add up to the cost', () => {
    const now = d('2026-10-27');
    expect(bookValueCents(120_000, d('2025-04-10'), 10, now) + depreciationCents(120_000, d('2025-04-10'), 10, now)).toBe(120_000);
  });
});

describe('recurring service', () => {
  it('adds months, keeping the day where the month is long enough', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-10-15', 6)).toBe('2027-04-15');
    expect(addMonths('2026-12-31', 2)).toBe('2027-02-28');
    expect(addMonths('2026-03-31', 12)).toBe('2027-03-31');
  });

  it('works out the next service from the last one, by date and by kilometres', () => {
    expect(nextDue({ everyMonths: 6, everyKm: 5000 }, { date: '2026-10-27', km: 42_000 })).toEqual({ dueAt: '2027-04-27', dueKm: 47_000 });
    expect(nextDue({ everyMonths: 12, everyKm: null }, { date: '2026-10-27', km: null })).toEqual({ dueAt: '2027-10-27', dueKm: null });
    expect(nextDue({ everyMonths: null, everyKm: 10_000 }, { date: '2026-10-27', km: null })).toEqual({ dueAt: null, dueKm: null });
  });

  it('reminds before the date, near the kilometres, and says when it is overdue', () => {
    expect(dueSoon({ dueAt: '2026-11-05', dueKm: null }, '2026-10-27', 14, null)).toEqual({ byDate: true, byKm: false, overdue: false });
    expect(dueSoon({ dueAt: '2026-12-25', dueKm: null }, '2026-10-27', 14, null)).toEqual({ byDate: false, byKm: false, overdue: false });
    expect(dueSoon({ dueAt: '2026-10-20', dueKm: null }, '2026-10-27', 14, null)).toMatchObject({ byDate: true, overdue: true });
    expect(dueSoon({ dueAt: null, dueKm: 47_000 }, '2026-10-27', 14, 46_600)).toEqual({ byDate: false, byKm: true, overdue: false });
    expect(dueSoon({ dueAt: null, dueKm: 47_000 }, '2026-10-27', 14, 47_100)).toMatchObject({ byKm: true, overdue: true });
    expect(dueSoon({ dueAt: null, dueKm: 47_000 }, '2026-10-27', 14, 40_000)).toEqual({ byDate: false, byKm: false, overdue: false });
  });
});

import { describe, expect, it } from 'vitest';
import { classStats, termSummary } from '@/lib/system/summary';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('term card', () => {
  const term = { startDate: d('2026-01-12'), endDate: d('2026-04-10') }; // 13 weeks and a day, end date included
  it('counts weeks remaining, rounding up and counting the last day', () => {
    expect(termSummary(term, d('2026-01-12'))).toMatchObject({ state: 'running', weeksRemaining: 13 });
    expect(termSummary(term, d('2026-04-05'))).toMatchObject({ state: 'running', weeksRemaining: 1 });
    expect(termSummary(term, d('2026-04-10'))).toMatchObject({ state: 'running', weeksRemaining: 1 });
  });
  it('says when a term has not started or has ended', () => {
    expect(termSummary(term, d('2026-01-01'))).toMatchObject({ state: 'upcoming', weeksUntilStart: 2 });
    expect(termSummary(term, d('2026-04-11'))).toEqual({ state: 'ended', weeksRemaining: 0, weeksUntilStart: 0 });
  });
});

describe('classes card', () => {
  const classes = [{ id: 'a', capacity: 40 }, { id: 'b', capacity: 40 }, { id: 'c', capacity: 30 }];
  it('averages class size over all active classes and counts those over capacity', () => {
    expect(classStats(classes, new Map([['a', 41], ['b', 40], ['c', 30]]))).toEqual({ classes: 3, averageSize: 37, overCapacity: 1 });
  });
  it('counts an empty class in the average', () => {
    expect(classStats(classes, new Map([['a', 20]]))).toEqual({ classes: 3, averageSize: 6.7, overCapacity: 0 });
  });
  it('handles a school with no classes', () => {
    expect(classStats([], new Map())).toEqual({ classes: 0, averageSize: 0, overCapacity: 0 });
  });
  it('ignores enrolment counts for classes that are not active', () => {
    expect(classStats([{ id: 'a', capacity: 10 }], new Map([['a', 5], ['gone', 99]]))).toEqual({ classes: 1, averageSize: 5, overCapacity: 0 });
  });
});

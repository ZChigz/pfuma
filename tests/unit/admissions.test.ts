import { describe, expect, it } from 'vitest';
import { PIPELINE, STAGES, canMove, rankApplicants } from '@/lib/students/admissions';

describe('moving an applicant between stages', () => {
  it('goes forward along the pipeline, skipping stages if the school wants', () => {
    expect(canMove('APPLIED', 'SHORTLISTED')).toBeNull();
    expect(canMove('SHORTLISTED', 'TESTED')).toBeNull();
    expect(canMove('TESTED', 'OFFERED')).toBeNull();
    expect(canMove('APPLIED', 'OFFERED')).toBeNull(); // a school that does not test
    expect(canMove('OFFERED', 'ACCEPTED')).toBeNull();
  });

  it('never goes backwards or stands still', () => {
    expect(canMove('OFFERED', 'APPLIED')).toMatch(/forward/);
    expect(canMove('TESTED', 'SHORTLISTED')).toMatch(/forward/);
    expect(canMove('APPLIED', 'APPLIED')).toMatch(/already/);
  });

  it('can set aside (waitlist, reject, decline) from any stage that is not final', () => {
    for (const from of ['APPLIED', 'SHORTLISTED', 'TESTED', 'OFFERED', 'ACCEPTED', 'WAITLISTED'] as const) {
      for (const to of ['WAITLISTED', 'REJECTED', 'DECLINED'] as const) {
        if (from !== to) expect(canMove(from, to), `${from} → ${to}`).toBeNull();
      }
    }
  });

  it('lets the waiting list rejoin the pipeline', () => {
    expect(canMove('WAITLISTED', 'OFFERED')).toBeNull();
    expect(canMove('WAITLISTED', 'SHORTLISTED')).toBeNull();
  });

  it('treats Enrolled, Rejected and Declined as final', () => {
    for (const from of ['ENROLLED', 'REJECTED', 'DECLINED'] as const) {
      for (const to of STAGES) if (to !== from) expect(canMove(from, to), `${from} → ${to}`).toMatch(/cannot be moved/);
    }
  });

  it('never enrols by a plain move', () => {
    expect(canMove('ACCEPTED', 'ENROLLED')).toMatch(/Enrol/);
    expect(PIPELINE[PIPELINE.length - 1]).toBe('ENROLLED');
  });
});

const person = (fullName: string, over: Record<string, unknown> = {}) => ({ fullName, stage: 'SHORTLISTED' as const, grade7Units: null as number | null, testScore: null as number | null, oLevelPoints: null as number | null, ...over });

describe('ranking applicants', () => {
  it('puts the lowest Grade 7 units first', () => {
    const r = rankApplicants([person('C', { grade7Units: 12 }), person('A', { grade7Units: 6 }), person('B', { grade7Units: 9 })], 'units', 2);
    expect(r.map((x) => x.fullName)).toEqual(['A', 'B', 'C']);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3]);
  });

  it('puts the highest test score and the highest O Level points first', () => {
    const rows = [person('A', { testScore: 55, oLevelPoints: 20 }), person('B', { testScore: 80, oLevelPoints: 14 }), person('C', { testScore: 67, oLevelPoints: 31 })];
    expect(rankApplicants(rows, 'score', 3).map((x) => x.fullName)).toEqual(['B', 'C', 'A']);
    expect(rankApplicants(rows, 'points', 3).map((x) => x.fullName)).toEqual(['C', 'A', 'B']);
  });

  it('draws the cut-off at the number of places', () => {
    const rows = ['A', 'B', 'C', 'D'].map((n, i) => person(n, { grade7Units: 5 + i }));
    expect(rankApplicants(rows, 'units', 2).map((x) => x.withinPlaces)).toEqual([true, true, false, false]);
    expect(rankApplicants(rows, 'units', 0).every((x) => !x.withinPlaces)).toBe(true);
  });

  it('puts applicants without the value last, and leaves out rejected and declined ones', () => {
    const rows = [person('None'), person('Rejected', { grade7Units: 4, stage: 'REJECTED' }), person('Declined', { grade7Units: 4, stage: 'DECLINED' }), person('Scored', { grade7Units: 20 })];
    expect(rankApplicants(rows, 'units', 5).map((x) => x.fullName)).toEqual(['Scored', 'None']);
  });

  it('breaks ties by name, so the order is stable', () => {
    const rows = [person('Zed', { grade7Units: 8 }), person('Amy', { grade7Units: 8 })];
    expect(rankApplicants(rows, 'units', 1).map((x) => x.fullName)).toEqual(['Amy', 'Zed']);
  });
});

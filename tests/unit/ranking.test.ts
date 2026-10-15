import { describe, expect, it } from 'vitest';
import {
  assignPositions, passThreshold, requiredSubjects, summariseStudent, type MarkEntry, type OfferedSubject,
} from '@/lib/results';

const core = (id: string, maxMark = 100): OfferedSubject => ({ id, maxMark, core: true });
const elective = (id: string, maxMark = 100): OfferedSubject => ({ id, maxMark, core: false });
const OFFERED = [core('eng'), core('math'), core('sci'), core('hist'), elective('art'), elective('music')];

const score = (subjectId: string, rawMark: number): MarkEntry => ({ subjectId, rawMark, status: 'VERIFIED' });
const absent = (subjectId: string, excused = false): MarkEntry => ({ subjectId, rawMark: 0, status: 'ABSENT', excused });
const exempt = (subjectId: string): MarkEntry => ({ subjectId, rawMark: 0, status: 'EXEMPT' });

describe('overall percentage = average of subject percentages over the subjects that count', () => {
  it('averages percentages, not raw totals', () => {
    // 40/50 = 80 %, 50/100 = 50 %  →  65 %, whereas 90/150 would be 60 %
    const s = summariseStudent([score('a', 40), score('b', 50)], [core('a', 50), core('b', 100)]);
    expect(s.averagePercentage).toBeCloseTo(65);
    expect(s.totalMarks).toBe(90);
    expect(s.subjectsTaken).toBe(2);
  });

  it('divides by the subjects taken, not the subjects offered to the class', () => {
    const s = summariseStudent([score('eng', 60), score('math', 80), score('sci', 70)], OFFERED);
    expect(s.subjectsTaken).toBe(3);
    expect(s.subjectsOffered).toBe(6);
    expect(s.averagePercentage).toBeCloseTo(70);
  });

  it('an absence counts as 0', () => {
    const s = summariseStudent([score('eng', 80), absent('math')], [core('eng'), core('math')]);
    expect(s.subjectsTaken).toBe(2);
    expect(s.averagePercentage).toBeCloseTo(40);
    expect(s.totalMarks).toBe(80);
  });

  it('an excused absence is left out, like an exemption', () => {
    const s = summariseStudent([score('eng', 80), absent('math', true)], [core('eng'), core('math')]);
    expect(s.subjectsTaken).toBe(1);
    expect(s.averagePercentage).toBeCloseTo(80);
  });

  it('an exempt subject is left out of the count and the average', () => {
    const s = summariseStudent([score('eng', 60), score('math', 60), exempt('art')], OFFERED);
    expect(s.subjectsTaken).toBe(2);
    expect(s.averagePercentage).toBeCloseTo(60);
  });

  it('an entered zero is a real zero', () => {
    const s = summariseStudent([score('eng', 0), score('math', 100)], [core('eng'), core('math')]);
    expect(s.averagePercentage).toBe(50);
  });

  it('ignores marks for subjects the class does not offer', () => {
    const s = summariseStudent([score('eng', 50), score('other', 100)], [core('eng')]);
    expect(s.subjectsTaken).toBe(1);
    expect(s.averagePercentage).toBe(50);
  });

  it('a student with nothing that counts has 0 %, no subjects and is not ranked', () => {
    expect(summariseStudent([], OFFERED)).toMatchObject({ averagePercentage: 0, subjectsTaken: 0, ranked: false });
    expect(summariseStudent([exempt('eng')], OFFERED)).toMatchObject({ subjectsTaken: 0, ranked: false });
  });
});

describe('subjects passed (configurable pass grade)', () => {
  it('counts subjects at or above the pass mark', () => {
    const s = summariseStudent([score('eng', 50), score('math', 49), score('sci', 80), absent('hist')], OFFERED, 50);
    expect(s.subjectsPassed).toBe(2);
    expect(summariseStudent([score('eng', 50), score('math', 49)], OFFERED, 40).subjectsPassed).toBe(2);
    expect(summariseStudent([score('eng', 50), score('math', 49)], OFFERED, 60).subjectsPassed).toBe(0);
  });

  it('takes the pass mark from the grade boundary of the pass grade, 50 if there is none', () => {
    const boundaries = [{ letterGrade: 'A', minPercent: 80 }, { letterGrade: 'B', minPercent: 70 }, { letterGrade: 'C', minPercent: 60 }, { letterGrade: 'D', minPercent: 50 }];
    expect(passThreshold(boundaries, 'C')).toBe(60);
    expect(passThreshold(boundaries, 'D')).toBe(50);
    expect(passThreshold(boundaries, 'B')).toBe(70);
    expect(passThreshold(boundaries, 'Z')).toBe(50);
    expect(passThreshold([], 'C')).toBe(50);
  });
});

describe('who is ranked', () => {
  it('needs at least half of the core subjects (rounded up) to count', () => {
    expect(requiredSubjects(OFFERED)).toBe(2);
    expect(requiredSubjects([core('a'), core('b'), core('c')])).toBe(2);
    expect(requiredSubjects([elective('a'), elective('b'), elective('c'), elective('d')])).toBe(2);
  });

  it('ranks a student who is absent from everything, at 0 %', () => {
    const s = summariseStudent(OFFERED.map((o) => absent(o.id)), OFFERED);
    expect(s.ranked).toBe(true);
    expect(s.averagePercentage).toBe(0);
  });

  it('does not rank a student exempt from most core subjects', () => {
    const s = summariseStudent([score('eng', 100), exempt('math'), exempt('sci'), exempt('hist')], OFFERED);
    expect(s.ranked).toBe(false);
  });

  it('electives alone do not make a student rankable', () => {
    expect(summariseStudent([score('art', 90), score('music', 90)], OFFERED).ranked).toBe(false);
  });
});

describe('assignPositions', () => {
  const st = (id: string, averagePercentage: number, subjectsPassed = 0, ranked = true) => ({ id, averagePercentage, subjectsPassed, ranked });

  it('ranks by average percentage by default', () => {
    const pos = assignPositions([st('a', 60, 6), st('b', 75, 2), st('c', 50, 9)]);
    expect([pos.get('b'), pos.get('a'), pos.get('c')]).toEqual([1, 2, 3]);
  });

  it('PASSES_THEN_AVERAGE ranks by subjects passed first, then average', () => {
    const students = [st('a', 60, 6), st('b', 75, 2), st('c', 70, 6)];
    const pos = assignPositions(students, 'PASSES_THEN_AVERAGE');
    expect([pos.get('c'), pos.get('a'), pos.get('b')]).toEqual([1, 2, 3]);
    // the same students by average only:
    const avg = assignPositions(students, 'AVERAGE');
    expect(avg.get('b')).toBe(1);
  });

  it('ties share a position and the next is skipped', () => {
    const pos = assignPositions([st('a', 90), st('b', 80), st('c', 80), st('d', 70)]);
    expect([pos.get('a'), pos.get('b'), pos.get('c'), pos.get('d')]).toEqual([1, 2, 2, 4]);
  });

  it('with passes-then-average a tie needs both to be equal', () => {
    const pos = assignPositions([st('a', 70, 5), st('b', 70, 5), st('c', 70, 4)], 'PASSES_THEN_AVERAGE');
    expect([pos.get('a'), pos.get('b'), pos.get('c')]).toEqual([1, 1, 3]);
  });

  it('treats averages equal to two decimals as a tie', () => {
    const pos = assignPositions([st('a', 66.664), st('b', 66.661)]);
    expect(pos.get('a')).toBe(pos.get('b'));
  });

  it('leaves unranked students out', () => {
    const pos = assignPositions([st('a', 50), st('ghost', 100, 9, false), st('b', 40)]);
    expect(pos.has('ghost')).toBe(false);
    expect(pos.size).toBe(2);
  });

  it('copes with an empty class', () => {
    expect(assignPositions([]).size).toBe(0);
  });
});

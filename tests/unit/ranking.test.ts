import { describe, expect, it } from 'vitest';
import { assignPositions, requiredSubjects, summariseStudent, type OfferedSubject } from '@/lib/results';

const core = (id: string, maxMark = 100): OfferedSubject => ({ id, maxMark, core: true });
const elective = (id: string, maxMark = 100): OfferedSubject => ({ id, maxMark, core: false });

const OFFERED = [core('eng'), core('math'), core('sci'), core('hist'), elective('art'), elective('music')];

describe('summariseStudent', () => {
  it('averages over the subjects sat; a missed exam is not a zero', () => {
    const s = summariseStudent(
      [{ subjectId: 'eng', rawMark: 80 }, { subjectId: 'math', rawMark: 60 }, { subjectId: 'sci', rawMark: 70 }],
      OFFERED,
    );
    expect(s.subjectsSat).toBe(3);
    expect(s.subjectsOffered).toBe(6);
    expect(s.totalMarks).toBe(210);
    expect(s.percentage).toBeCloseTo(70);
  });

  it('respects different maximum marks', () => {
    const s = summariseStudent(
      [{ subjectId: 'eng', rawMark: 40 }, { subjectId: 'math', rawMark: 50 }],
      [core('eng', 50), core('math', 100)],
    );
    expect(s.percentage).toBeCloseTo((90 / 150) * 100);
  });

  it('counts an entered zero as a real zero', () => {
    const s = summariseStudent([{ subjectId: 'eng', rawMark: 0 }, { subjectId: 'math', rawMark: 100 }], [core('eng'), core('math')]);
    expect(s.percentage).toBe(50);
    expect(s.subjectsSat).toBe(2);
  });

  it('ignores marks for subjects the class does not offer', () => {
    const s = summariseStudent([{ subjectId: 'eng', rawMark: 50 }, { subjectId: 'other', rawMark: 100 }], [core('eng')]);
    expect(s.subjectsSat).toBe(1);
    expect(s.percentage).toBe(50);
  });

  it('a student with no marks has 0 % and is not ranked', () => {
    const s = summariseStudent([], OFFERED);
    expect(s).toMatchObject({ percentage: 0, subjectsSat: 0, ranked: false });
  });
});

describe('who is ranked', () => {
  it('needs at least half of the core subjects (rounded up)', () => {
    expect(requiredSubjects(OFFERED)).toBe(2); // 4 core → 2
    expect(requiredSubjects([core('a'), core('b'), core('c')])).toBe(2); // 3 core → 2
  });

  it('uses all subjects when none is core', () => {
    expect(requiredSubjects([elective('a'), elective('b'), elective('c'), elective('d')])).toBe(2);
  });

  it('ranks a student who sat enough core subjects, whatever electives they took', () => {
    const noElectives = summariseStudent([{ subjectId: 'eng', rawMark: 70 }, { subjectId: 'math', rawMark: 70 }], OFFERED);
    const withElectives = summariseStudent(
      [{ subjectId: 'eng', rawMark: 70 }, { subjectId: 'math', rawMark: 70 }, { subjectId: 'art', rawMark: 90 }, { subjectId: 'music', rawMark: 90 }],
      OFFERED,
    );
    expect(noElectives.ranked).toBe(true);
    expect(withElectives.ranked).toBe(true);
  });

  it('does not rank a student who sat one core paper, even with a perfect score', () => {
    const s = summariseStudent([{ subjectId: 'eng', rawMark: 100 }], OFFERED);
    expect(s.percentage).toBe(100);
    expect(s.ranked).toBe(false);
  });

  it('electives alone do not make a student rankable', () => {
    const s = summariseStudent([{ subjectId: 'art', rawMark: 90 }, { subjectId: 'music', rawMark: 90 }], OFFERED);
    expect(s.ranked).toBe(false);
  });
});

describe('assignPositions', () => {
  const st = (id: string, percentage: number, ranked = true) => ({ id, percentage, ranked });

  it('orders by percentage, not by total marks', () => {
    // "b" sat fewer papers so has a lower total but a higher average.
    const a = summariseStudent([{ subjectId: 'eng', rawMark: 60 }, { subjectId: 'math', rawMark: 60 }, { subjectId: 'sci', rawMark: 60 }, { subjectId: 'hist', rawMark: 60 }], OFFERED);
    const b = summariseStudent([{ subjectId: 'eng', rawMark: 80 }, { subjectId: 'math', rawMark: 80 }], OFFERED);
    expect(a.totalMarks).toBeGreaterThan(b.totalMarks);
    const pos = assignPositions([{ id: 'a', ...a }, { id: 'b', ...b }]);
    expect(pos.get('b')).toBe(1);
    expect(pos.get('a')).toBe(2);
  });

  it('gives ties the same position and skips the next', () => {
    const pos = assignPositions([st('a', 90), st('b', 80), st('c', 80), st('d', 70)]);
    expect([pos.get('a'), pos.get('b'), pos.get('c'), pos.get('d')]).toEqual([1, 2, 2, 4]);
  });

  it('treats percentages equal to two decimals as a tie', () => {
    const pos = assignPositions([st('a', 66.664), st('b', 66.661)]);
    expect(pos.get('a')).toBe(pos.get('b'));
  });

  it('leaves unranked students without a position and does not count them', () => {
    const pos = assignPositions([st('a', 50), st('ghost', 100, false), st('b', 40)]);
    expect(pos.has('ghost')).toBe(false);
    expect(pos.get('a')).toBe(1);
    expect(pos.get('b')).toBe(2);
    expect(pos.size).toBe(2);
  });

  it('copes with an empty class', () => {
    expect(assignPositions([]).size).toBe(0);
  });
});

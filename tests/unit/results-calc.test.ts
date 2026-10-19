// @vitest-environment node
// The results calculations, with the brief's worked example (Form 3, plan 20% tests, 20% project, 60% exam).
import { describe, expect, it } from 'vitest';
import {
  aLevelPoints, calculateTermMark, classStats, countPasses, entriesFor, entryOf, fivePassesWithEnglishAndMaths, gradeOf, outliers,
  overallAverage, passMarkOf, projectEntry, rankDescending, roundMark, validatePlan,
  type AssessmentInput, type MarkInput, type PlanLine, type ScaleBand,
} from '@/lib/results';
import { DEFAULT_SCALES } from '@/lib/system/grading-scales';

const PLAN: PlanLine[] = [
  { key: 'tests', label: 'Class tests and assignments', weight: 20, rule: 'AVERAGE', bestN: null, typeIds: ['test', 'assignment'] },
  { key: 'project', label: 'School-based project', weight: 20, rule: 'AVERAGE', bestN: null, typeIds: ['project'] },
  { key: 'exam', label: 'End-of-term exam', weight: 60, rule: 'AVERAGE', bestN: null, typeIds: ['exam'] },
];
const A = (id: string, typeId: string, maxMark: number, countsToTerm = true): AssessmentInput => ({ id, typeId, maxMark, countsToTerm });
const M = (assessmentId: string, value: number | null, code: MarkInput['code'] = null): MarkInput => ({ assessmentId, value, code });
const marksOf = (...ms: MarkInput[]) => new Map(ms.map((m) => [m.assessmentId, m]));

const ASSESSMENTS = [A('t1', 'test', 50), A('t2', 'test', 50), A('p1', 'project', 50), A('e1', 'exam', 100)];
const scale: ScaleBand[] = DEFAULT_SCALES.O_LEVEL;

describe('the term mark', () => {
  it('matches the worked example: 0.2 x 70 + 0.2 x 72 + 0.6 x 58 = 63.2, shown as 63, grade B', () => {
    const entries = entriesFor(ASSESSMENTS, marksOf(M('t1', 30), M('t2', 40), M('p1', 36), M('e1', 58)));
    const r = calculateTermMark(PLAN, entries);
    expect(r.lines.map((l) => l.score)).toEqual([70, 72, 58]);
    expect(r.termMark).toBe(63.2);
    expect(r.roundedMark).toBe(63);
    expect(r.incomplete).toBe(false);
    expect(gradeOf(r.roundedMark, scale)).toEqual({ grade: 'B', points: null, remark: 'Very good' });
  });

  it('rounds the stored 2-decimal mark to a whole number, halves up, and grades the rounded mark', () => {
    expect(roundMark(62.5)).toBe(63);
    expect(roundMark(62.49)).toBe(62);
    expect(roundMark(59.5)).toBe(60); // 59.5 shows as 60 and so grades B, not C
    expect(gradeOf(roundMark(59.5), scale).grade).toBe('B');
    expect(gradeOf(roundMark(59.49), scale).grade).toBe('C');
  });

  it('stores two decimal places', () => {
    // 100 / 3 = 33.333...: only the exam counts
    const r = calculateTermMark([{ ...PLAN[2]!, weight: 100 }], entriesFor([A('e', 'exam', 3)], marksOf(M('e', 1))));
    expect(r.termMark).toBe(33.33);
    expect(r.roundedMark).toBe(33);
  });

  it('counts AB and NS as 0', () => {
    const ab = calculateTermMark(PLAN, entriesFor(ASSESSMENTS, marksOf(M('t1', 30), M('t2', null, 'AB'), M('p1', 36), M('e1', 58))));
    expect(ab.lines[0]!.score).toBe(30); // (60 + 0) / 2
    expect(ab.termMark).toBe(55.2); // 6 + 14.4 + 34.8
    const ns = calculateTermMark(PLAN, entriesFor(ASSESSMENTS, marksOf(M('t1', 30), M('t2', 40), M('p1', null, 'NS'), M('e1', 58))));
    expect(ns.lines[1]!.score).toBe(0);
    expect(ns.termMark).toBe(48.8); // 14 + 0 + 34.8
  });

  it('leaves EX out of the line, and an exempt line out of the mark, scaling the other weights up to 100%', () => {
    // t2 exempt: tests line is just t1 = 60%
    const ex = calculateTermMark(PLAN, entriesFor(ASSESSMENTS, marksOf(M('t1', 30), M('t2', null, 'EX'), M('p1', 36), M('e1', 58))));
    expect(ex.lines[0]!.score).toBe(60);
    expect(ex.termMark).toBe(61.2); // 12 + 14.4 + 34.8
    // project exempt: (20 x 70 + 60 x 58) / 80 = 61
    const noProject = calculateTermMark(PLAN, entriesFor(ASSESSMENTS, marksOf(M('t1', 30), M('t2', 40), M('p1', null, 'EX'), M('e1', 58))));
    expect(noProject.lines[1]!.score).toBeNull();
    expect(noProject.leftOutLines).toEqual(['School-based project']);
    expect(noProject.termMark).toBe(61);
  });

  it('leaves an absence the Head excused out, like EX', () => {
    const r = calculateTermMark(PLAN, entriesFor(ASSESSMENTS, marksOf(M('t1', 30), M('t2', 40), M('p1', null, 'AB_EXCUSED'), M('e1', 58))));
    expect(r.termMark).toBe(61);
  });

  it('gives no mark when everything is exempt, and flags a mark that is still missing', () => {
    const none = calculateTermMark(PLAN, entriesFor(ASSESSMENTS, marksOf(M('t1', null, 'EX'), M('t2', null, 'EX'), M('p1', null, 'EX'), M('e1', null, 'EX'))));
    expect(none.termMark).toBeNull();
    expect(none.roundedMark).toBeNull();
    const missing = calculateTermMark(PLAN, entriesFor(ASSESSMENTS, marksOf(M('t1', 30), M('p1', 36), M('e1', 58))));
    expect(missing.incomplete).toBe(true);
  });

  it('ignores assessments that do not count towards the term, and types that are not on the plan', () => {
    const list = [...ASSESSMENTS, A('t3', 'test', 10, false), A('o1', 'other', 10)];
    const r = calculateTermMark(PLAN, entriesFor(list, marksOf(M('t1', 30), M('t2', 40), M('t3', 0), M('o1', 0), M('p1', 36), M('e1', 58))));
    expect(r.termMark).toBe(63.2);
  });

  it('combines a line by best N', () => {
    const line: PlanLine = { key: 'tests', label: 'Tests', weight: 100, rule: 'BEST_N', bestN: 2, typeIds: ['test'] };
    const list = [A('a', 'test', 10), A('b', 'test', 10), A('c', 'test', 10)];
    const r = calculateTermMark([line], entriesFor(list, marksOf(M('a', 2), M('b', 8), M('c', 6))));
    expect(r.termMark).toBe(70); // best two: 80% and 60%
    const few = calculateTermMark([{ ...line, bestN: 5 }], entriesFor(list, marksOf(M('a', 2), M('b', 8), M('c', 6))));
    expect(few.termMark).toBe(53.33); // fewer than N: all of them
  });

  it('counts an absence in best N as a 0 that can be dropped', () => {
    const line: PlanLine = { key: 'tests', label: 'Tests', weight: 100, rule: 'BEST_N', bestN: 2, typeIds: ['test'] };
    const list = [A('a', 'test', 10), A('b', 'test', 10), A('c', 'test', 10)];
    const r = calculateTermMark([line], entriesFor(list, marksOf(M('a', 8), M('b', null, 'AB'), M('c', 6))));
    expect(r.termMark).toBe(70);
  });

  it('combines a line weighted by maximum mark', () => {
    const line: PlanLine = { key: 'tests', label: 'Tests', weight: 100, rule: 'BY_MAX', bestN: null, typeIds: ['test'] };
    const list = [A('a', 'test', 20), A('b', 'test', 100)];
    const r = calculateTermMark([line], entriesFor(list, marksOf(M('a', 20), M('b', 50))));
    expect(r.termMark).toBe(58.33); // 70 / 120, not the average of 100% and 50%
    const avg = calculateTermMark([{ ...line, rule: 'AVERAGE' }], entriesFor(list, marksOf(M('a', 20), M('b', 50))));
    expect(avg.termMark).toBe(75);
  });

  it('by maximum: an absence counts its full maximum as 0 marks, an exemption none', () => {
    const line: PlanLine = { key: 'tests', label: 'Tests', weight: 100, rule: 'BY_MAX', bestN: null, typeIds: ['test'] };
    const list = [A('a', 'test', 20), A('b', 'test', 80)];
    expect(calculateTermMark([line], entriesFor(list, marksOf(M('a', 20), M('b', null, 'AB')))).termMark).toBe(20);
    expect(calculateTermMark([line], entriesFor(list, marksOf(M('a', 20), M('b', null, 'EX')))).termMark).toBe(100);
  });

  it('is not changed by a different grading scale: the mark is the same, only the grade differs', () => {
    const r = calculateTermMark(PLAN, entriesFor(ASSESSMENTS, marksOf(M('t1', 30), M('t2', 40), M('p1', 36), M('e1', 58))));
    const stricter: ScaleBand[] = scale.map((b) => (b.letterGrade === 'B' ? { ...b, minPercent: 65 } : b.letterGrade === 'C' ? { ...b, maxPercent: 64 } : b));
    expect(gradeOf(r.roundedMark, scale).grade).toBe('B');
    expect(gradeOf(r.roundedMark, stricter).grade).toBe('C');
    expect(r.termMark).toBe(63.2);
  });
});

describe('school-based projects', () => {
  const project = A('p', 'project', 100);
  it('totals the stages: proposal 8/10, research 15/20, practical 30/40, report 22/30 = 75/100', () => {
    const e = projectEntry(project, [{ maxMark: 10, value: 8, code: null }, { maxMark: 20, value: 15, code: null }, { maxMark: 40, value: 30, code: null }, { maxMark: 30, value: 22, code: null }]);
    expect(e).toMatchObject({ state: 'SCORED', earned: 75, possible: 100 });
  });
  it('leaves an exempt stage out of the maximum too, counts an absent one as 0', () => {
    const stages = [{ maxMark: 10, value: 8, code: null }, { maxMark: 20, value: null, code: 'EX' as const }, { maxMark: 20, value: null, code: 'AB' as const }];
    expect(projectEntry(project, stages)).toMatchObject({ state: 'SCORED', earned: 8, possible: 30 });
  });
  it('is incomplete while a stage is empty, and left out when every stage is exempt', () => {
    expect(projectEntry(project, [{ maxMark: 10, value: 8, code: null }, { maxMark: 20, value: null, code: null }]).state).toBe('MISSING');
    expect(projectEntry(project, [{ maxMark: 10, value: null, code: 'EX' }, { maxMark: 20, value: null, code: 'EX' }]).state).toBe('LEFT_OUT');
  });
  it('feeds the plan like any other assessment', () => {
    const list = [A('t1', 'test', 50), A('p', 'project', 50), A('e1', 'exam', 100)];
    const stages = new Map([['p', [{ maxMark: 20, value: 18, code: null }, { maxMark: 30, value: 18, code: null }]]]);
    const r = calculateTermMark(PLAN, entriesFor(list, marksOf(M('t1', 35), M('e1', 58)), stages));
    expect(r.lines[1]!.score).toBe(72); // 36 / 50
    expect(entryOf(list[0]!, undefined).state).toBe('MISSING');
  });
});

describe('positions and averages', () => {
  it('uses standard competition ranking: 1, 2, 2, 4', () => {
    const r = rankDescending([{ id: 'a', value: 80 }, { id: 'b', value: 75 }, { id: 'c', value: 75 }, { id: 'd', value: 60 }]);
    expect(Array.from(r.entries()).map(([id, x]) => `${id}:${x.position}/${x.size}`)).toEqual(['a:1/4', 'b:2/4', 'c:2/4', 'd:4/4']);
  });
  it('compares values rounded to 2 decimal places', () => {
    const r = rankDescending([{ id: 'a', value: 70.001 }, { id: 'b', value: 70.004 }, { id: 'c', value: 70.006 }]);
    // 70.001 and 70.004 are both 70.00, 70.006 is 70.01: c is first, a and b tie for second
    expect(r.get('c')!.position).toBe(1);
    expect(r.get('a')!.position).toBe(2);
    expect(r.get('b')!.position).toBe(2);
  });
  it('does not rank students without a value, and does not count them in the size', () => {
    const r = rankDescending([{ id: 'a', value: 50 }, { id: 'b', value: null }]);
    expect(r.get('a')).toEqual({ position: 1, size: 1 });
    expect(r.has('b')).toBe(false);
  });
  it('averages the subject term marks over the subjects taken, not a raw total', () => {
    // A takes 8 subjects at 70, B takes 9 at 70 plus one more at 40: B has the larger total but the lower average
    const a = overallAverage(Array(8).fill(70));
    const b = overallAverage([...Array(9).fill(70), 40]);
    expect(a).toBe(70);
    expect(b).toBe(67);
    expect(rankDescending([{ id: 'A', value: a }, { id: 'B', value: b }]).get('A')!.position).toBe(1);
  });
  it('leaves subjects with no mark (exempt) out of the average', () => {
    expect(overallAverage([80, 60, null])).toBe(70);
    expect(overallAverage([null, null])).toBeNull();
  });
});

describe('level summaries', () => {
  const passMark = passMarkOf(scale, 'C'); // 50
  const subjects = (marks: number[]) => marks.map((m, i) => ({ subjectId: `s${i}`, roundedMark: m, points: null }));
  it('finds the pass mark from the school pass grade', () => {
    expect(passMark).toBe(50);
    expect(passMarkOf(scale, 'B')).toBe(60);
  });
  it('counts O Level passes (grade C or better)', () => {
    expect(countPasses(subjects([75, 50, 49, 20, 61]), passMark)).toBe(3);
  });
  it('flags 5 or more passes including English and Mathematics', () => {
    const all = subjects([60, 55, 52, 50, 70, 30]); // s0 English, s1 Maths
    expect(fivePassesWithEnglishAndMaths(all, passMark, 5, 's0', 's1')).toBe(true);
    expect(fivePassesWithEnglishAndMaths(subjects([60, 40, 52, 50, 70, 80]), passMark, 5, 's0', 's1')).toBe(false); // Maths failed
    expect(fivePassesWithEnglishAndMaths(subjects([60, 60, 52, 50, 30, 30]), passMark, 5, 's0', 's1')).toBe(false); // only 4 passes
    expect(fivePassesWithEnglishAndMaths(all, passMark, 5, null, 's1')).toBeNull();
  });
  it('adds A Level points for the best 3 subjects (A = 5 ... E = 1)', () => {
    const a = DEFAULT_SCALES.A_LEVEL;
    const pts = (marks: number[]) => marks.map((m, i) => ({ subjectId: `s${i}`, roundedMark: m, points: gradeOf(m, a).points }));
    expect(aLevelPoints(pts([85, 72, 65, 45]))).toBe(5 + 4 + 3);
    expect(aLevelPoints(pts([85, 72]))).toBe(9);
  });
});

describe('class statistics and outliers', () => {
  it('gives the count, mean, highest, lowest and pass rate', () => {
    expect(classStats([40, 50, 60, 70], 50)).toMatchObject({ count: 4, mean: 55, highest: 70, lowest: 40, passRate: 75 });
    expect(classStats([], 50)).toMatchObject({ count: 0, mean: null, passRate: null });
  });
  it('flags a mark more than 3 standard deviations from the class mean', () => {
    const marks = [...Array(30).fill(50), 51, 49, 52, 48, 0];
    expect(outliers(marks, 3)).toEqual([34]);
    expect(outliers([50, 50, 50, 50, 50, 50], 3)).toEqual([]);
    expect(outliers([1, 100], 3)).toEqual([]); // too few to judge
  });
});

describe('plan validation', () => {
  const ok = [
    { label: 'Tests', weight: 20, rule: 'AVERAGE' as const, typeIds: ['a', 'b'] },
    { label: 'Project', weight: 20, rule: 'AVERAGE' as const, typeIds: ['c'] },
    { label: 'Exam', weight: 60, rule: 'AVERAGE' as const, typeIds: ['d'] },
  ];
  it('accepts weights that add up to 100', () => expect(validatePlan(ok)).toBeNull());
  it('refuses weights that do not', () => expect(validatePlan([{ ...ok[0]!, weight: 25 }, ok[1]!, ok[2]!])).toMatch(/105%/));
  it('adds weights without floating-point noise', () => {
    expect(validatePlan([{ ...ok[0]!, weight: 33.3 }, { ...ok[1]!, weight: 33.3 }, { ...ok[2]!, weight: 33.4 }])).toBeNull();
  });
  it('refuses a type on two lines, a line with no type, and best N without a count', () => {
    expect(validatePlan([ok[0]!, { ...ok[1]!, typeIds: ['a'] }, ok[2]!])).toMatch(/only be on one line/);
    expect(validatePlan([{ ...ok[0]!, typeIds: [] }])).toMatch(/choose at least one/);
    expect(validatePlan([{ label: 'T', weight: 100, rule: 'BEST_N', bestN: null, typeIds: ['a'] }])).toMatch(/how many/);
  });
  it('allows a mock-only plan', () => expect(validatePlan([{ label: 'Mock exam', weight: 100, rule: 'AVERAGE', typeIds: ['m'] }])).toBeNull());
});

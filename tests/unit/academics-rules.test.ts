// @vitest-environment node
// The Academics rules that need no database: timetable placement, school days and term weeks, who may change a register
// and when, attendance rates, workload bands, bell schedule checks, initials, coverage and the syllabus tree.
import { describe, expect, it } from 'vitest';
import {
  checkPlacement, findClashes, placedReport, secondOfDouble, suggestSlots, type AssignInfo, type PeriodInfo, type PlanData, type RoomInfo, type SlotInfo,
} from '@/lib/academics/timetable-rules';
import { dayInfo, termWeeks } from '@/lib/academics/school-days';
import { CORRECTION_WINDOW_DAYS, attendanceRate, editModeFor, effectiveEditDate, EntrySchema } from '@/lib/academics/attendance';
import { loadStatus } from '@/lib/academics/assignments';
import { validateDay } from '@/lib/academics/bell';
import { bandOf, initialsOf, subjectLimits, weekdayOf } from '@/lib/academics/common';
import { buildTree, coveragePercent } from '@/lib/academics/curriculum';
import { SubjectSchema, STARTER_SUBJECTS } from '@/lib/academics/subjects';
import { AssignmentSchema } from '@/lib/academics/assignments';

// ─── A small timetable world ─────────────────────────────────────────────────

const P = (id: string, dayOfWeek: number, periodNo: number, start: string, end: string, type: PeriodInfo['type'] = 'LESSON'): PeriodInfo => ({ id, dayOfWeek, periodNo, start, end, type });
const periods: PeriodInfo[] = [
  P('m1', 1, 1, '07:30', '08:05'), P('m2', 1, 2, '08:05', '08:40'), P('m3', 1, 3, '08:40', '09:15'), { ...P('mB', 1, 4, '09:15', '09:35', 'BREAK'), label: 'Tea' },
  P('m5', 1, 5, '09:35', '10:10'), P('m6', 1, 6, '10:10', '10:45'), P('m7', 1, 7, '10:45', '11:20'),
  P('t1', 2, 1, '07:30', '08:05'), P('t2', 2, 2, '08:05', '08:40'),
];
const A = (o: Partial<AssignInfo> & { id: string }): AssignInfo => ({
  teacherId: 'tMaths', coTeacherId: null, subjectId: 'maths', classId: 'c1', groupId: null, periodsPerWeek: 2, doublesPerWeek: 0, isPractical: false,
  subjectName: 'Maths', targetName: 'Form 1 North', teacherName: 'Mr Chikore', audienceSize: 30, active: true, ...o,
});
const S = (o: Partial<SlotInfo> & { id: string; assignmentId: string; periodId: string }): SlotInfo => ({
  roomId: null, teacherId: 'tMaths', coTeacherId: null, classId: 'c1', groupId: null, subjectId: 'maths', isDouble: false, pairId: null, ...o,
});
const rooms = new Map<string, RoomInfo>([
  ['r1', { id: 'r1', name: 'Room 1', type: 'CLASSROOM', capacity: 45, active: true }],
  ['lab', { id: 'lab', name: 'Science Lab', type: 'LABORATORY', capacity: 40, active: true }],
  ['old', { id: 'old', name: 'Old hall', type: 'HALL', capacity: 200, active: false }],
]);
const plan = (assignments: AssignInfo[], slots: SlotInfo[] = [], more: Partial<PlanData> = {}): PlanData => ({
  periods, slots, assignments: new Map(assignments.map((a) => [a.id, a])), groupMembers: new Map(), studentClass: new Map(), unavailable: new Map(), rooms,
  teacherNames: new Map([['tMaths', 'Mr Chikore'], ['tEng', 'Mrs Moyo'], ['tCo', 'Ms Ncube']]), ...more,
});

describe('timetable: hard rules', () => {
  it('places a lesson in a free period', () => {
    const r = checkPlacement(plan([A({ id: 'a1' })]), { assignmentId: 'a1', periodId: 'm1' });
    expect(r.ok).toBe(true);
    expect(r.periodIds).toEqual(['m1']);
  });

  it('refuses a teacher who is already in another lesson', () => {
    const data = plan([A({ id: 'a1' }), A({ id: 'a2', classId: 'c2', targetName: 'Form 1 South', subjectId: 'sci', subjectName: 'Comb Sci' })], [S({ id: 's1', assignmentId: 'a2', periodId: 'm1', classId: 'c2', subjectId: 'sci' })]);
    const r = checkPlacement(data, { assignmentId: 'a1', periodId: 'm1' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Mr Chikore already teaches Comb Sci to Form 1 South in Monday period 1/);
  });

  it('refuses the second teacher when they are busy', () => {
    const data = plan(
      [A({ id: 'a1', coTeacherId: 'tCo' }), A({ id: 'a2', teacherId: 'tCo', classId: 'c2', targetName: 'Form 2 East', subjectName: 'Geography', subjectId: 'geo' })],
      [S({ id: 's1', assignmentId: 'a2', periodId: 'm2', teacherId: 'tCo', classId: 'c2', subjectId: 'geo' })],
    );
    expect(checkPlacement(data, { assignmentId: 'a1', periodId: 'm2' }).errors.join()).toMatch(/Ms Ncube already teaches/);
  });

  it('refuses a class that already has a lesson in the period', () => {
    const data = plan([A({ id: 'a1' }), A({ id: 'a2', teacherId: 'tEng', subjectId: 'eng', subjectName: 'English' })], [S({ id: 's1', assignmentId: 'a2', periodId: 'm1', teacherId: 'tEng', subjectId: 'eng' })]);
    const r = checkPlacement(data, { assignmentId: 'a1', periodId: 'm1' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Form 1 North already has English in Monday period 1/);
  });

  it('refuses a room that is already used in the period', () => {
    const data = plan([A({ id: 'a1' }), A({ id: 'a2', teacherId: 'tEng', classId: 'c2', targetName: 'Form 2 East', subjectId: 'eng', subjectName: 'English' })], [S({ id: 's1', assignmentId: 'a2', periodId: 'm1', teacherId: 'tEng', classId: 'c2', subjectId: 'eng', roomId: 'r1' })]);
    const r = checkPlacement(data, { assignmentId: 'a1', periodId: 'm1', roomId: 'r1' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Room 1 is already used by English for Form 2 East/);
    expect(checkPlacement(data, { assignmentId: 'a1', periodId: 'm1', roomId: 'lab' }).ok).toBe(true);
  });

  it('refuses a room that is not in use', () => {
    expect(checkPlacement(plan([A({ id: 'a1' })]), { assignmentId: 'a1', periodId: 'm1', roomId: 'old' }).errors[0]).toMatch(/not in use/);
  });

  it('refuses a break or any non-lesson period', () => {
    expect(checkPlacement(plan([A({ id: 'a1' })]), { assignmentId: 'a1', periodId: 'mB' }).errors[0]).toMatch(/not a lesson period/);
  });

  it('refuses more periods than the assignment says', () => {
    const data = plan([A({ id: 'a1', periodsPerWeek: 2 })], [S({ id: 's1', assignmentId: 'a1', periodId: 'm1' }), S({ id: 's2', assignmentId: 'a1', periodId: 't1' })]);
    const r = checkPlacement(data, { assignmentId: 'a1', periodId: 'm2' });
    expect(r.errors[0]).toMatch(/2 of 2 periods placed already/);
  });

  it('puts the same lesson in a period only once', () => {
    const data = plan([A({ id: 'a1', periodsPerWeek: 3 })], [S({ id: 's1', assignmentId: 'a1', periodId: 'm1' })]);
    expect(checkPlacement(data, { assignmentId: 'a1', periodId: 'm1' }).errors.join()).toMatch(/already in Monday period 1/);
  });

  it('lets a lesson be moved onto the place it is leaving', () => {
    const data = plan([A({ id: 'a1' })], [S({ id: 's1', assignmentId: 'a1', periodId: 'm1' }), S({ id: 's2', assignmentId: 'a1', periodId: 't1' })]);
    expect(checkPlacement(data, { assignmentId: 'a1', periodId: 'm2', ignoreSlotIds: new Set(['s1']) }).ok).toBe(true);
  });
});

describe('timetable: double periods', () => {
  const dbl = (o: Partial<AssignInfo> = {}) => A({ id: 'a1', periodsPerWeek: 4, doublesPerWeek: 1, ...o });

  it('uses two consecutive lesson periods', () => {
    const r = checkPlacement(plan([dbl()]), { assignmentId: 'a1', periodId: 'm1', isDouble: true });
    expect(r.ok).toBe(true);
    expect(r.periodIds).toEqual(['m1', 'm2']);
  });

  it('cannot run across a break', () => {
    const r = checkPlacement(plan([dbl()]), { assignmentId: 'a1', periodId: 'm3', isDouble: true });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/can't run across a break: Tea follows Monday period 3/);
    expect(secondOfDouble(periods, periods.find((p) => p.id === 'm3')!).second).toBeNull();
  });

  it('cannot start in the last period of the day', () => {
    expect(checkPlacement(plan([dbl()]), { assignmentId: 'a1', periodId: 'm7', isDouble: true }).errors[0]).toMatch(/last period of the day/);
  });

  it('needs both periods to be free', () => {
    const data = plan([dbl(), A({ id: 'a2', teacherId: 'tEng', subjectId: 'eng', subjectName: 'English' })], [S({ id: 's1', assignmentId: 'a2', periodId: 'm2', teacherId: 'tEng', subjectId: 'eng' })]);
    expect(checkPlacement(data, { assignmentId: 'a1', periodId: 'm1', isDouble: true }).ok).toBe(false);
  });

  it('counts as two periods of the week', () => {
    const data = plan([dbl({ periodsPerWeek: 2 })], [S({ id: 's1', assignmentId: 'a1', periodId: 't1' })]);
    expect(checkPlacement(data, { assignmentId: 'a1', periodId: 'm1', isDouble: true }).errors[0]).toMatch(/a double needs two more/);
  });

  it('needs the assignment to allow doubles, and no more than it allows', () => {
    expect(checkPlacement(plan([dbl({ doublesPerWeek: 0 })]), { assignmentId: 'a1', periodId: 'm1', isDouble: true }).errors[0]).toMatch(/has no double periods/);
    const data = plan([dbl({ periodsPerWeek: 6 })], [S({ id: 's1', assignmentId: 'a1', periodId: 'm1', isDouble: true, pairId: 'p' }), S({ id: 's2', assignmentId: 'a1', periodId: 'm2', isDouble: true, pairId: 'p' })]);
    expect(checkPlacement(data, { assignmentId: 'a1', periodId: 'm5', isDouble: true }).errors[0]).toMatch(/already has all 1 of its double periods/);
  });
});

describe('timetable: teaching groups', () => {
  const group = A({ id: 'g1', teacherId: 'tEng', classId: null, groupId: 'grp', subjectId: 'acc', subjectName: 'Accounts', targetName: 'Form 3 Accounts' });
  const members = new Map([['grp', new Set(['st1', 'st2'])], ['grp2', new Set(['st2', 'st3'])], ['grp3', new Set(['st9'])]]);
  const studentClass = new Map([['st1', 'c1'], ['st2', 'c2'], ['st3', 'c2'], ['st9', 'c3']]);

  it("can't clash with a lesson of a class that has its students", () => {
    const data = plan([group, A({ id: 'a1' })], [S({ id: 's1', assignmentId: 'a1', periodId: 'm1' })], { groupMembers: members, studentClass });
    const r = checkPlacement(data, { assignmentId: 'g1', periodId: 'm1' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Form 1 North already has Maths/);
  });

  it('is fine in a period when the classes of its students have no lesson', () => {
    const data = plan([group, A({ id: 'a1', classId: 'c3' })], [S({ id: 's1', assignmentId: 'a1', periodId: 'm1', classId: 'c3' })], { groupMembers: members, studentClass });
    expect(checkPlacement(data, { assignmentId: 'g1', periodId: 'm1' }).ok).toBe(true);
  });

  it("can't clash with another group that shares students", () => {
    const other = A({ id: 'g2', teacherId: 'tCo', classId: null, groupId: 'grp2', subjectId: 'geo', subjectName: 'Geography', targetName: 'Form 3 Geography' });
    const data = plan([group, other], [S({ id: 's1', assignmentId: 'g2', periodId: 'm1', teacherId: 'tCo', classId: null, groupId: 'grp2', subjectId: 'geo' })], { groupMembers: members, studentClass });
    expect(checkPlacement(data, { assignmentId: 'g1', periodId: 'm1' }).errors[0]).toMatch(/Form 3 Geography already has Geography/);
  });

  it('can run at the same time as a group with different students', () => {
    const other = A({ id: 'g3', teacherId: 'tCo', classId: null, groupId: 'grp3', subjectId: 'phy', subjectName: 'Physics', targetName: 'Form 3 Physics' });
    const data = plan([group, other], [S({ id: 's1', assignmentId: 'g3', periodId: 'm1', teacherId: 'tCo', classId: null, groupId: 'grp3', subjectId: 'phy' })], { groupMembers: members, studentClass });
    expect(checkPlacement(data, { assignmentId: 'g1', periodId: 'm1' }).ok).toBe(true);
  });

  it('is found as a clash when two such lessons are placed anyway', () => {
    const data = plan([group, A({ id: 'a1' })], [S({ id: 's1', assignmentId: 'a1', periodId: 'm1' }), S({ id: 's2', assignmentId: 'g1', periodId: 'm1', teacherId: 'tEng', classId: null, groupId: 'grp', subjectId: 'acc' })], { groupMembers: members, studentClass });
    expect(findClashes(data).join()).toMatch(/share students in Monday period 1/);
  });
});

describe('timetable: warnings (allowed)', () => {
  it('same subject twice in a day', () => {
    const data = plan([A({ id: 'a1', periodsPerWeek: 3 })], [S({ id: 's1', assignmentId: 'a1', periodId: 'm1' })]);
    const r = checkPlacement(data, { assignmentId: 'a1', periodId: 'm3' });
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/Maths is already taught to Form 1 North on Monday/);
  });

  it('a teacher with more than four periods in a row, and a break in between does not count as a row', () => {
    const mk = (ps: string[]) => plan([A({ id: 'a1', classId: 'c9', periodsPerWeek: 9 }), A({ id: 'o', classId: 'cx', subjectId: 'sx' })], ps.map((p, i) => S({ id: `k${i}`, assignmentId: 'o', periodId: p, classId: `cx${i}`, subjectId: 'sx' })));
    const five = checkPlacement(mk(['m1', 'm2', 'm3']), { assignmentId: 'a1', periodId: 'mB' });
    expect(five.errors.length).toBeGreaterThan(0); // not a lesson period
    const run = checkPlacement(mk(['m5', 'm6']), { assignmentId: 'a1', periodId: 'm7' });
    expect(run.warnings.join()).not.toMatch(/in a row/); // three
    const long = plan([A({ id: 'a1', classId: 'c9', periodsPerWeek: 9 }), A({ id: 'o', classId: 'cx', subjectId: 'sx' })], [], {
      periods: [P('a', 1, 1, '07:00', '07:30'), P('b', 1, 2, '07:30', '08:00'), P('c', 1, 3, '08:00', '08:30'), P('d', 1, 4, '08:30', '09:00'), P('e', 1, 5, '09:00', '09:30')],
    });
    long.slots = ['a', 'b', 'c', 'd'].map((p, i) => S({ id: `L${i}`, assignmentId: 'o', periodId: p, classId: `cx${i}`, subjectId: 'sx' }));
    expect(checkPlacement(long, { assignmentId: 'a1', periodId: 'e' }).warnings.join()).toMatch(/5 periods in a row on Monday/);
  });

  it('a practical subject outside a lab', () => {
    const data = plan([A({ id: 'a1', isPractical: true, subjectName: 'Comb Sci' })]);
    expect(checkPlacement(data, { assignmentId: 'a1', periodId: 'm1', roomId: 'r1' }).warnings.join()).toMatch(/practical subject and Room 1 is not a lab/);
    expect(checkPlacement(data, { assignmentId: 'a1', periodId: 'm1' }).warnings.join()).toMatch(/no lab is chosen/);
    expect(checkPlacement(data, { assignmentId: 'a1', periodId: 'm1', roomId: 'lab' }).warnings).toEqual([]);
  });

  it("a teacher's unavailable time and free day", () => {
    const off = new Map([['tMaths', new Set(['m2'])]]);
    expect(checkPlacement(plan([A({ id: 'a1' })], [], { unavailable: off }), { assignmentId: 'a1', periodId: 'm2' }).warnings.join()).toMatch(/Mr Chikore is not available in Monday period 2/);
    const all = new Map([['tMaths', new Set(['m1', 'm2', 'm3', 'm5', 'm6', 'm7'])]]);
    expect(checkPlacement(plan([A({ id: 'a1' })], [], { unavailable: all }), { assignmentId: 'a1', periodId: 'm2' }).warnings.join()).toMatch(/Monday is Mr Chikore's free day/);
  });

  it('a room smaller than the class', () => {
    const data = plan([A({ id: 'a1', audienceSize: 50 })]);
    expect(checkPlacement(data, { assignmentId: 'a1', periodId: 'm1', roomId: 'r1' }).warnings.join()).toMatch(/Room 1 holds 45 and Form 1 North has 50 students/);
  });
});

describe('timetable: reports and suggestions', () => {
  it('reports periods placed against periods wanted, leaving ended assignments out', () => {
    const data = plan([A({ id: 'a1', periodsPerWeek: 3, doublesPerWeek: 1 }), A({ id: 'gone', active: false })], [S({ id: 's1', assignmentId: 'a1', periodId: 'm1', isDouble: true, pairId: 'p' }), S({ id: 's2', assignmentId: 'a1', periodId: 'm2', isDouble: true, pairId: 'p' })]);
    const rep = placedReport(data);
    expect(rep).toHaveLength(1);
    expect(rep[0]).toMatchObject({ placed: 2, needed: 3, doublesPlaced: 1, doublesNeeded: 1 });
  });

  it('finds no clashes in a clean timetable', () => {
    const data = plan([A({ id: 'a1' }), A({ id: 'a2', teacherId: 'tEng', classId: 'c2', subjectId: 'eng' })], [S({ id: 's1', assignmentId: 'a1', periodId: 'm1' }), S({ id: 's2', assignmentId: 'a2', periodId: 'm1', teacherId: 'tEng', classId: 'c2', subjectId: 'eng' })]);
    expect(findClashes(data)).toEqual([]);
  });

  it('finds a teacher, a class and a room used twice', () => {
    const data = plan([A({ id: 'a1' }), A({ id: 'a2', targetName: 'Form 1 North' })], [
      S({ id: 's1', assignmentId: 'a1', periodId: 'm1', roomId: 'r1' }), S({ id: 's2', assignmentId: 'a2', periodId: 'm1', roomId: 'r1' }),
    ]);
    const out = findClashes(data).join('|');
    expect(out).toMatch(/Mr Chikore is in two lessons/);
    expect(out).toMatch(/share students/);
    expect(out).toMatch(/Room 1 is used twice/);
  });

  it('suggests only the slots where the lesson fits, and says why not for the rest', () => {
    const data = plan([A({ id: 'a1', periodsPerWeek: 2 }), A({ id: 'a2', teacherId: 'tEng', subjectId: 'eng' })], [S({ id: 's1', assignmentId: 'a2', periodId: 'm1', teacherId: 'tEng', subjectId: 'eng' })]);
    const out = suggestSlots(data, 'a1');
    expect(out.every((s) => periods.find((p) => p.id === s.periodId)!.type === 'LESSON')).toBe(true);
    expect(out.find((s) => s.periodId === 'm1')).toMatchObject({ free: false });
    expect(out.find((s) => s.periodId === 'm1')!.reasons[0]).toMatch(/already has/);
    expect(out.filter((s) => s.free).length).toBe(out.length - 1);
  });
});

// ─── School days and term weeks ──────────────────────────────────────────────

const term = { id: 't1', name: 'Term 3 2026', status: 'OPEN' as const, startDate: new Date('2026-09-01'), endDate: new Date('2026-12-04') };
const holidays = new Map([['2026-10-14', 'Test holiday']]);

describe('school days', () => {
  it('counts weekdays inside the term', () => {
    expect(dayInfo('2026-10-15', [term], new Map(), false)).toMatchObject({ isSchoolDay: true, reason: null });
  });
  it('has no school at weekends, on public holidays or outside the term', () => {
    expect(dayInfo('2026-10-17', [term], new Map(), false)).toMatchObject({ isSchoolDay: false, reason: 'WEEKEND' });
    expect(dayInfo('2026-10-18', [term], new Map(), true)).toMatchObject({ isSchoolDay: false, reason: 'WEEKEND' });
    expect(dayInfo('2026-10-14', [term], holidays, false)).toMatchObject({ isSchoolDay: false, reason: 'HOLIDAY', holidayName: 'Test holiday' });
    expect(dayInfo('2026-08-20', [term], new Map(), false)).toMatchObject({ isSchoolDay: false, reason: 'OUTSIDE_TERM' });
  });
  it('counts Saturday only when the school teaches then', () => {
    expect(dayInfo('2026-10-17', [term], new Map(), true).isSchoolDay).toBe(true);
  });
  it('numbers the teaching weeks from the term dates and skips a holiday week', () => {
    const weeks = termWeeks(term, new Map(), false);
    expect(weeks[0]).toMatchObject({ weekNo: 1, startDate: '2026-09-01', schoolDays: 4 });
    expect(weeks.length).toBe(14);
    const break1 = new Map(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map((d) => [d, 'Mid-term break'] as const));
    const skipped = termWeeks(term, break1, false);
    expect(skipped.length).toBe(13);
    expect(skipped.map((w) => w.weekNo)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(skipped.some((w) => w.startDate === '2026-10-12')).toBe(false);
  });
  it('gives week days as Monday = 1', () => {
    expect(weekdayOf('2026-10-14')).toBe(3);
    expect(weekdayOf('2026-10-18')).toBe(7);
  });
});

// ─── Attendance rules ────────────────────────────────────────────────────────

describe('who may change a register, and when', () => {
  it('lets the class teacher change it freely on the same day', () => {
    expect(editModeFor('2026-10-14', '2026-10-14', false, false)).toEqual({ mode: 'FREE', message: null });
  });
  it('needs a reason for a later day, up to 7 days', () => {
    expect(editModeFor('2026-10-13', '2026-10-14', false, false).mode).toBe('REASON');
    expect(editModeFor('2026-10-07', '2026-10-14', false, false).mode).toBe('REASON');
  });
  it('needs the Deputy for anything older than 7 days', () => {
    expect(CORRECTION_WINDOW_DAYS).toBe(7);
    expect(editModeFor('2026-10-06', '2026-10-14', false, false).mode).toBe('DEPUTY');
    expect(editModeFor('2026-10-06', '2026-10-14', true, false).mode).toBe('REASON');
  });
  it('cannot change a closed term', () => {
    expect(editModeFor('2026-10-14', '2026-10-14', true, true).mode).toBe('LOCKED');
  });
  it('judges an offline register by the day the phone recorded it', () => {
    const now = new Date('2026-10-15T09:00:00Z');
    expect(effectiveEditDate('2026-10-14T10:30:00+02:00', now)).toBe('2026-10-14');
    expect(effectiveEditDate(undefined, now)).toBe('2026-10-15');
    expect(effectiveEditDate('2026-12-01T10:30:00+02:00', now)).toBe('2026-10-15'); // a clock in the future counts as now
    expect(effectiveEditDate('2026-09-01T10:30:00+02:00', now)).toBe('2026-10-15'); // more than a week back: the day it arrives
  });
});

describe('a mark in the register', () => {
  const ok = (e: object) => EntrySchema.safeParse({ studentId: 's1', ...e }).success;
  it('needs a reason when excused and a time when late', () => {
    expect(ok({ status: 'EXCUSED' })).toBe(false);
    expect(ok({ status: 'EXCUSED', reason: 'SICK' })).toBe(true);
    expect(ok({ status: 'LATE' })).toBe(false);
    expect(ok({ status: 'LATE', arrivalTime: '08:12' })).toBe(true);
    expect(ok({ status: 'LATE', arrivalTime: '8:12' })).toBe(false);
  });
  it('keeps reasons and times to the marks they belong to', () => {
    expect(ok({ status: 'PRESENT', reason: 'SICK' })).toBe(false);
    expect(ok({ status: 'PRESENT', arrivalTime: '08:00' })).toBe(false);
    expect(ok({ status: 'ABSENT', reason: 'FAMILY' })).toBe(true);
    expect(ok({ status: 'ABSENT' })).toBe(true);
  });
});

describe('attendance rate', () => {
  it('counts present and late as attending, and excused as not', () => {
    expect(attendanceRate({ present: 8, late: 1, absent: 1, excused: 0 })).toBe(90);
    expect(attendanceRate({ present: 8, late: 0, absent: 0, excused: 2 })).toBe(80);
  });
  it('has no rate before anything is marked', () => {
    expect(attendanceRate({ present: 0, late: 0, absent: 0, excused: 0 })).toBeNull();
  });
});

// ─── The rest ────────────────────────────────────────────────────────────────

describe('teaching load', () => {
  it('is over above the maximum, under below half of it, and none with no lessons', () => {
    expect(loadStatus(37, 36)).toBe('over');
    expect(loadStatus(36, 36)).toBe('ok');
    expect(loadStatus(17, 36)).toBe('under');
    expect(loadStatus(18, 36)).toBe('ok');
    expect(loadStatus(0, 36)).toBe('none');
  });
});

describe('bell schedule', () => {
  const day = (periods: { periodNo: number; start: string; end: string; type?: 'LESSON' | 'BREAK' }[]) => validateDay({ dayOfWeek: 1, periods: periods.map((p) => ({ type: 'LESSON' as const, label: null, ...p })) });
  it('accepts periods in time order', () => {
    expect(day([{ periodNo: 1, start: '07:30', end: '08:05' }, { periodNo: 2, start: '08:05', end: '08:40' }])).toBeNull();
  });
  it('refuses overlaps, a period that ends before it starts, repeated numbers and numbers out of order', () => {
    expect(day([{ periodNo: 1, start: '07:30', end: '08:10' }, { periodNo: 2, start: '08:05', end: '08:40' }])).toMatch(/overlap/);
    expect(day([{ periodNo: 1, start: '08:30', end: '08:10' }])).toMatch(/must end after it starts/);
    expect(day([{ periodNo: 1, start: '07:30', end: '08:05' }, { periodNo: 1, start: '08:05', end: '08:40' }])).toMatch(/listed twice/);
    expect(day([{ periodNo: 2, start: '07:30', end: '08:05' }, { periodNo: 1, start: '08:05', end: '08:40' }])).toMatch(/follow the times/);
  });
});

describe('helpers', () => {
  it('makes initials without titles', () => {
    expect(initialsOf('Mr Tendai Chikore')).toBe('TC');
    expect(initialsOf('Dr. Rudo Moyo')).toBe('RM');
    expect(initialsOf('Mrs Ncube')).toBe('N');
  });
  it('splits O and A Level for the subject limits', () => {
    expect(bandOf(4)).toBe('O');
    expect(bandOf(5)).toBe('A');
    const s = { minSubjectsOLevel: 8, maxSubjectsOLevel: 10, minSubjectsALevel: 3, maxSubjectsALevel: 4 } as never;
    expect(subjectLimits(s, 2)).toEqual({ min: 8, max: 10 });
    expect(subjectLimits(s, 6)).toEqual({ min: 3, max: 4 });
  });
  it('works out syllabus coverage against what is due by now', () => {
    const weeks = [
      { topicIds: ['a', 'b'], startDate: '2026-09-01', record: { coveredTopicIds: ['a'] } },
      { topicIds: ['c'], startDate: '2026-09-08', record: { coveredTopicIds: ['c'] } },
      { topicIds: ['d'], startDate: '2026-11-01', record: null },
    ];
    expect(coveragePercent(weeks, '2026-09-10')).toEqual({ due: 3, covered: 2, pct: 67 });
    expect(coveragePercent(weeks, '2026-12-01')).toEqual({ due: 4, covered: 2, pct: 50 });
    expect(coveragePercent(weeks, '2026-08-01')).toEqual({ due: 0, covered: 0, pct: null });
  });
  it('builds the syllabus tree in order', () => {
    const tree = buildTree([
      { id: '2', title: 'Simultaneous equations', objectives: null, order: 1, parentId: '1' },
      { id: '1', title: 'Algebra', objectives: null, order: 0, parentId: null },
      { id: '3', title: 'Linear equations', objectives: null, order: 0, parentId: '1' },
      { id: '4', title: 'Geometry', objectives: null, order: 1, parentId: null },
    ]);
    expect(tree.map((t) => t.title)).toEqual(['Algebra', 'Geometry']);
    expect(tree[0]!.children.map((t) => t.title)).toEqual(['Linear equations', 'Simultaneous equations']);
  });
});

describe('subject and assignment input', () => {
  const base = { name: 'Geography', shortName: 'Geog', code: 'geo', departmentId: 'd1', examBoard: 'ZIMSEC', levels: [{ levelId: 'l1', type: 'CORE' }] };
  it('needs a name, a short name for the timetable, a code, a department and a form', () => {
    expect(SubjectSchema.safeParse(base).success).toBe(true);
    expect(SubjectSchema.parse(base).code).toBe('GEO');
    for (const bad of [{ name: '' }, { shortName: '' }, { code: 'x' }, { departmentId: '' }, { levels: [] }, { examBoard: 'IGCSE' }, { colour: 'red' }]) {
      expect(SubjectSchema.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it('limits the short name to what fits a timetable cell', () => {
    expect(SubjectSchema.safeParse({ ...base, shortName: 'A very long short name' }).success).toBe(false);
  });
  it('has a starter list with no duplicate codes or names, every subject offered somewhere and the Heritage-Based subjects in it', () => {
    const codes = STARTER_SUBJECTS.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(STARTER_SUBJECTS.map((s) => s.name)).size).toBe(codes.length);
    for (const s of STARTER_SUBJECTS) {
      expect(Object.keys(s.levels).length, s.name).toBeGreaterThan(0);
      expect(SubjectSchema.shape.shortName.safeParse(s.shortName).success, s.name).toBe(true);
    }
    for (const needed of ['English Language', 'Mathematics', 'Combined Science', 'Heritage Studies', 'Geography', 'History', 'Accounts', 'Agriculture']) expect(STARTER_SUBJECTS.map((s) => s.name)).toContain(needed);
    expect(new Set(STARTER_SUBJECTS.map((s) => s.department))).toEqual(new Set(['Languages', 'Sciences', 'Humanities', 'Commercials', 'Technical and Vocational', 'Arts and Physical Education']));
  });
  it('wants a class or a group (not both) and doubles that fit in the periods', () => {
    const a = { teacherId: 't', subjectId: 's', periodsPerWeek: 4 };
    expect(AssignmentSchema.safeParse({ ...a, classId: 'c' }).success).toBe(true);
    expect(AssignmentSchema.safeParse({ ...a, groupId: 'g' }).success).toBe(true);
    expect(AssignmentSchema.safeParse(a).success).toBe(false);
    expect(AssignmentSchema.safeParse({ ...a, classId: 'c', groupId: 'g' }).success).toBe(false);
    expect(AssignmentSchema.safeParse({ ...a, classId: 'c', doublesPerWeek: 3 }).success).toBe(false);
    expect(AssignmentSchema.safeParse({ ...a, classId: 'c', doublesPerWeek: 2 }).success).toBe(true);
    expect(AssignmentSchema.safeParse({ ...a, classId: 'c', coTeacherId: 't' }).success).toBe(false);
    expect(AssignmentSchema.safeParse({ ...a, classId: 'c', periodsPerWeek: 0 }).success).toBe(false);
  });
});

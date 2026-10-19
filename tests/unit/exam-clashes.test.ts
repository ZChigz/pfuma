// @vitest-environment node
// The exam timetable's clash rules and the seating allocation.
import { describe, expect, it } from 'vitest';
import { allocateSeats, endTime, findClashes, type ClashPaper } from '@/lib/exams/clashes';

const room = (id: string, cap = 30) => ({ roomId: id, roomName: `Room ${id}`, examCapacity: cap });
const paper = (id: string, o: Partial<ClashPaper> = {}): ClashPaper => ({
  id, name: `Paper ${id}`, subjectId: `sub-${id}`, levelId: 'f2', date: '2026-11-02', session: 'MORNING', startTime: '08:00', durationMinutes: 120, rooms: [room(`r-${id}`)], ...o,
});
const students = (n: number, prefix = 's') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const cands = (m: Record<string, string[]>) => new Map(Object.entries(m));

describe('blocked clashes', () => {
  it('blocks a student who takes two subjects scheduled in the same session', () => {
    const c = findClashes([paper('maths'), paper('geo')], cands({ maths: students(5), geo: ['s2', 's3'] }));
    const clash = c.find((x) => x.kind === 'STUDENT_SAME_SESSION')!;
    expect(clash.severity).toBe('block');
    expect(clash.studentIds).toEqual(['s2', 's3']);
    expect(clash.message).toMatch(/2 students.*same session/);
  });

  it('allows the same two papers in different sessions or on different days', () => {
    const shared = cands({ maths: students(5), geo: students(5) });
    expect(findClashes([paper('maths'), paper('geo', { session: 'AFTERNOON', startTime: '13:00' })], shared).filter((x) => x.severity === 'block')).toEqual([]);
    expect(findClashes([paper('maths'), paper('geo', { date: '2026-11-03' })], shared).filter((x) => x.severity === 'block')).toEqual([]);
  });

  it('allows papers in one session when nobody sits both (different electives)', () => {
    expect(findClashes([paper('geo'), paper('hist')], cands({ geo: ['s1', 's2'], hist: ['s3', 's4'] })).filter((x) => x.severity === 'block')).toEqual([]);
  });

  it('blocks a room holding more candidates than its exam capacity, and a paper with no room', () => {
    const c = findClashes([paper('maths', { rooms: [room('a', 20)] }), paper('eng', { date: '2026-11-03', rooms: [] })], cands({ maths: students(25), eng: students(3) }));
    expect(c.find((x) => x.kind === 'ROOM_CAPACITY')!.message).toMatch(/25 candidates but only 20 seats/);
    expect(c.find((x) => x.kind === 'NO_ROOMS')).toBeTruthy();
  });

  it('allows several rooms that together hold the candidates', () => {
    const c = findClashes([paper('maths', { rooms: [room('a', 20), room('b', 20)] })], cands({ maths: students(35) }));
    expect(c.filter((x) => x.severity === 'block')).toEqual([]);
  });

  it('blocks one room used by two papers in the same session', () => {
    const c = findClashes([paper('maths', { rooms: [room('hall', 100)] }), paper('geo', { rooms: [room('hall', 100)] })], cands({ maths: ['s1'], geo: ['s2'] }));
    expect(c.find((x) => x.kind === 'ROOM_DOUBLE_BOOKED')!.severity).toBe('block');
  });
});

describe('warnings', () => {
  it('warns about a student with more than 2 papers in a day', () => {
    const ps = [paper('a'), paper('b', { session: 'AFTERNOON', startTime: '13:00' }), paper('c', { session: 'AFTERNOON', startTime: '15:30', durationMinutes: 60 })];
    const c = findClashes(ps, cands({ a: ['s1'], b: ['s1'], c: ['s1'] }));
    expect(c.find((x) => x.kind === 'STUDENT_MANY_PAPERS')).toMatchObject({ severity: 'warn', studentIds: ['s1'] });
  });

  it('does not warn about exactly 2 papers in a day', () => {
    const ps = [paper('a'), paper('b', { session: 'AFTERNOON', startTime: '14:00' })];
    expect(findClashes(ps, cands({ a: ['s1'], b: ['s1'] })).filter((x) => x.kind === 'STUDENT_MANY_PAPERS')).toEqual([]);
  });

  it('warns about 3 hours or more of exam time back to back', () => {
    // 10:00-12:00 then 12:30-14:00: 3.5 hours with only a half hour between
    const ps = [paper('a', { startTime: '10:00' }), paper('b', { session: 'AFTERNOON', startTime: '12:30', durationMinutes: 90 })];
    const c = findClashes(ps, cands({ a: ['s1'], b: ['s1'] }));
    expect(c.find((x) => x.kind === 'STUDENT_LONG_DAY')).toMatchObject({ severity: 'warn', studentIds: ['s1'] });
  });

  it('does not warn when there is a proper break between papers, or when they total less than 3 hours', () => {
    const wide = [paper('a', { startTime: '08:00' }), paper('b', { session: 'AFTERNOON', startTime: '14:00', durationMinutes: 120 })];
    expect(findClashes(wide, cands({ a: ['s1'], b: ['s1'] })).filter((x) => x.kind === 'STUDENT_LONG_DAY')).toEqual([]);
    const short = [paper('a', { startTime: '10:00', durationMinutes: 60 }), paper('b', { session: 'AFTERNOON', startTime: '12:30', durationMinutes: 60 })];
    expect(findClashes(short, cands({ a: ['s1'], b: ['s1'] })).filter((x) => x.kind === 'STUDENT_LONG_DAY')).toEqual([]);
  });

  it('keeps warnings out of the blocked list', () => {
    const ps = [paper('a'), paper('b', { session: 'AFTERNOON', startTime: '12:30' })];
    expect(findClashes(ps, cands({ a: ['s1'], b: ['s1'] })).every((c) => c.severity === 'warn')).toBe(true);
  });
});

describe('seating', () => {
  it('fills the rooms in turn up to their exam capacity, with desk numbers from 1', () => {
    const placed = allocateSeats(students(7), [{ roomId: 'a', examCapacity: 4 }, { roomId: 'b', examCapacity: 4 }]);
    expect(placed[0]!.seats.map((s) => [s.desk, s.candidate])).toEqual([[1, 's1'], [2, 's2'], [3, 's3'], [4, 's4']]);
    expect(placed[1]!.seats.map((s) => [s.desk, s.candidate])).toEqual([[1, 's5'], [2, 's6'], [3, 's7']]);
  });
  it('leaves candidates unseated when there are not enough seats', () => {
    const placed = allocateSeats(students(5), [{ roomId: 'a', examCapacity: 3 }]);
    expect(placed[0]!.seats).toHaveLength(3);
  });
  it('works out when a paper ends', () => {
    expect(endTime({ startTime: '08:30', durationMinutes: 150 })).toBe('11:00');
    expect(endTime({ startTime: '13:45', durationMinutes: 90 })).toBe('15:15');
  });
});

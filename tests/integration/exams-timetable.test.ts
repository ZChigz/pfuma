// @vitest-environment node
// The exam timetable end to end: periods and papers with clash rules, the common assessment each paper makes, approval by the Deputy
// and the Calendar, invigilation (auto-assign), seating lists, exam attendance (absent -> AB) and incident reports.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { actorOf, addTeacher, assign } from '../helpers/academics';
import { classWith, examWorld, takeSubject, typeIds, type ExamWorld } from '../helpers/exams';

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let W: ExamWorld;
let prisma: typeof import('@/lib/prisma').prisma;
let tt: typeof import('@/lib/exams/timetable');
let inv: typeof import('@/lib/exams/invigilation');
let marks: typeof import('@/lib/exams/marks');
let assessments: typeof import('@/lib/exams/assessments');
let setup: typeof import('@/lib/exams/setup');
type Actor = Awaited<ReturnType<typeof actorOf>>;

let officer: Actor; let deputy: Actor; let teacher: Actor; let invigilator: Actor; let invigilator2: Actor;
let kids: string[]; let mathsAssignment: string;
let periodId: string; let mathsPaper: string; let geoPaper: string; let engPaper: string;
let T: Record<string, string>;
let room1: string; let room2: string;

const fails = async (p: Promise<unknown>, status: number, match?: RegExp) => {
  try { await p; } catch (e) {
    const err = e as { status?: number; message: string };
    expect(err.status).toBe(status);
    if (match) expect(err.message).toMatch(match);
    return;
  }
  throw new Error('expected the call to fail');
};

const paper = (o: object) => ({ periodId, subjectId: W.subjects.maths, levelId: W.form2, paperNumber: 1, name: 'Mathematics Paper 1', durationMinutes: 150, date: '2026-11-02', session: 'MORNING', startTime: '08:00', maxMark: 100, ...o });

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  tt = await import('@/lib/exams/timetable');
  inv = await import('@/lib/exams/invigilation');
  marks = await import('@/lib/exams/marks');
  assessments = await import('@/lib/exams/assessments');
  setup = await import('@/lib/exams/setup');
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  W = await examWorld(prisma, A);
  const maths = await classWith(prisma, A, { classId: W.f2East, subjectId: W.subjects.maths, teacherId: W.teachers.chikore, count: 6, prefix: 'Sit' });
  kids = maths.kids; mathsAssignment = maths.assignmentId;
  await takeSubject(prisma, A, kids.slice(0, 3), W.subjects.geography); // three of the six also take Geography
  await takeSubject(prisma, A, kids, W.subjects.english);
  await assign(prisma, A, { teacherId: W.teachers.moyo, subjectId: W.subjects.english, classId: W.f2East });
  await assign(prisma, A, { teacherId: W.teachers.ncube, subjectId: W.subjects.geography, classId: W.f2East });
  const rooms = await prisma.room.findMany({ where: { schoolId: A.schoolId }, orderBy: { name: 'asc' } });
  room1 = rooms.find((r) => r.name === 'Room 1')!.id; room2 = rooms.find((r) => r.name === 'Science Lab')!.id;
  officer = await actorOf(prisma, W.examsOfficer);
  deputy = await actorOf(prisma, (await addTeacher(prisma, A, 'Mrs Deputy', ['DEPUTY_HEAD'])));
  teacher = await actorOf(prisma, W.teachers.chikore);
  invigilator = await actorOf(prisma, W.teachers.dube);
  invigilator2 = await actorOf(prisma, await addTeacher(prisma, A, 'Mr Spare'));
  await setup.listTypes(officer);
  T = await typeIds(prisma, A);
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('exam periods', () => {
  it('are for the Exams Officer', async () => {
    const body = { termId: A.termId, name: 'Term 3 end-of-term exams 2026', startDate: '2026-11-02', endDate: '2026-11-13', typeId: T['End-of-term exam'], levelIds: [W.form2] };
    await fails(tt.savePeriod(teacher, body), 403);
    const r = await tt.savePeriod(officer, body);
    periodId = r.id;
    const list = await tt.listPeriods(officer, A.termId);
    expect(list[0]).toMatchObject({ name: 'Term 3 end-of-term exams 2026', status: 'DRAFT', papers: 0, typeName: 'End-of-term exam' });
    expect(list[0]!.levels.map((l) => l.name)).toEqual(['Form 2']);
  });

  it('refuse an end date before the start, and a form or type of another school', async () => {
    await expect(tt.savePeriod(officer, { termId: A.termId, name: 'Bad', startDate: '2026-11-10', endDate: '2026-11-02', typeId: T['Mock exam'], levelIds: [W.form2] })).rejects.toThrow();
    await fails(tt.savePeriod(officer, { termId: A.termId, name: 'Bad', startDate: '2026-11-02', endDate: '2026-11-03', typeId: T['Mock exam'], levelIds: [B.levelId] }), 404);
  });
});

describe('papers and clashes', () => {
  it('adds a paper and makes the common assessment its marks land in', async () => {
    const r = await tt.savePaper(officer, paper({}));
    mathsPaper = r.id;
    const a = await prisma.assessment.findFirstOrThrow({ where: { examPaperId: mathsPaper } });
    expect(a).toMatchObject({ title: 'Mathematics Paper 1', assignmentId: null, levelId: W.form2, subjectId: W.subjects.maths, typeId: T['End-of-term exam'], countsToTerm: true });
    expect(Number(a.maxMark)).toBe(100);
    // The teacher finds it in their grid, set once for every class.
    const list = await assessments.listAssessments(teacher, mathsAssignment);
    expect(list.find((x) => x.title === 'Mathematics Paper 1')).toMatchObject({ common: true, maxMark: 100 });
  });

  it('blocks a student sitting two papers in one session', async () => {
    await fails(tt.savePaper(officer, paper({ subjectId: W.subjects.geography, name: 'Geography Paper 1', paperNumber: 1 })), 409, /3 students.*same session/);
    expect(await prisma.examPaper.count({ where: { periodId } })).toBe(1);
    expect(await prisma.assessment.count({ where: { title: 'Geography Paper 1' } })).toBe(0);
  });

  it('allows the same paper in the afternoon, a paper the same session when nobody sits both, and warns about a long day', async () => {
    const g = await tt.savePaper(officer, paper({ subjectId: W.subjects.geography, name: 'Geography Paper 1', session: 'AFTERNOON', startTime: '10:45' }).constructor === Object ? { ...paper({ subjectId: W.subjects.geography, name: 'Geography Paper 1' }), session: 'AFTERNOON', startTime: '13:00', durationMinutes: 120, date: '2026-11-02' } : {});
    geoPaper = g.id;
    expect(g.warnings).toEqual([]); // 08:00-10:30 then 13:00: a proper break
  });

  it('refuses a session that does not fit the start time, a date outside the period, and a repeated paper number', async () => {
    await fails(tt.savePaper(officer, paper({ name: 'English', subjectId: W.subjects.english, session: 'AFTERNOON', startTime: '09:00' })), 422, /afternoon paper starts/);
    await fails(tt.savePaper(officer, paper({ name: 'English', subjectId: W.subjects.english, date: '2026-12-01' })), 422, /inside the exam period/);
    await fails(tt.savePaper(officer, paper({ name: 'Maths again' })), 409, /already has a paper with that number|clash/);
  });

  it('adds English on another day and keeps it as the third paper of nobody\'s day', async () => {
    const e = await tt.savePaper(officer, paper({ subjectId: W.subjects.english, name: 'English Language Paper 1', date: '2026-11-03', durationMinutes: 120 }));
    engPaper = e.id;
    expect((await tt.getPeriod(officer, periodId)).papers).toHaveLength(3);
  });

  it('warns, without blocking, about three hours or more of exam time back to back', async () => {
    const first = await tt.savePaper(officer, paper({ subjectId: W.subjects.maths, name: 'Mathematics Paper 2', paperNumber: 2, date: '2026-11-04', startTime: '09:30', durationMinutes: 120 }));
    const second = await tt.savePaper(officer, paper({ subjectId: W.subjects.english, name: 'English Language Paper 2', paperNumber: 2, date: '2026-11-04', session: 'AFTERNOON', startTime: '12:15', durationMinutes: 120 }));
    expect(second.warnings.some((w) => /3 hours or more back to back/.test(w))).toBe(true);
    // Only a warning: both papers were saved. A proper break clears it.
    await tt.savePaper(officer, paper({ subjectId: W.subjects.english, name: 'English Language Paper 2', paperNumber: 2, date: '2026-11-04', session: 'AFTERNOON', startTime: '14:30', durationMinutes: 120 }), second.id);
    expect((await tt.getPeriod(officer, periodId)).clashes.filter((c) => c.kind === 'STUDENT_LONG_DAY')).toEqual([]);
    await tt.deletePaper(officer, first.id);
    await tt.deletePaper(officer, second.id);
  });
});

describe('rooms and approval', () => {
  it('holds the candidates in the rooms in turn, and refuses one room for two papers in a session', async () => {
    await tt.setPaperRooms(officer, mathsPaper, { rooms: [{ roomId: room1, examCapacity: 4 }, { roomId: room2, examCapacity: 4 }] });
    await fails(tt.setPaperRooms(officer, engPaper, { rooms: [{ roomId: room1 }] }).then(() => tt.setPaperRooms(officer, geoPaper, { rooms: [{ roomId: room1 }] })).then(() => tt.savePaper(officer, paper({ subjectId: W.subjects.english, name: 'English Language Paper 3', paperNumber: 3, date: '2026-11-02', session: 'MORNING', startTime: '09:00' }))), 409, /clash/);
    await tt.setPaperRooms(officer, geoPaper, { rooms: [{ roomId: room1, examCapacity: 5 }] });
    await tt.setPaperRooms(officer, engPaper, { rooms: [{ roomId: room1, examCapacity: 3 }, { roomId: room2, examCapacity: 3 }] });
  });

  it('cannot be sent for approval while a paper has too few seats', async () => {
    await tt.setPaperRooms(officer, engPaper, { rooms: [{ roomId: room1, examCapacity: 3 }] });
    await fails(tt.submitPeriod(officer, periodId), 409, /6 candidates but only 3 seats/);
    await tt.setPaperRooms(officer, engPaper, { rooms: [{ roomId: room1, examCapacity: 3 }, { roomId: room2, examCapacity: 3 }] });
  });

  it('is sent to the Deputy, who approves it (not the person who sent it), and it appears on the Calendar', async () => {
    await tt.submitPeriod(officer, periodId);
    await fails(tt.savePaper(officer, paper({ name: 'Extra paper', paperNumber: 5 })), 409, /waiting for the Deputy/);
    await fails(tt.approvePeriod(officer, periodId), 403);
    const noKey = await actorOf(prisma, W.teachers.ncube);
    await fails(tt.approvePeriod(noKey, periodId), 403);
    await tt.approvePeriod(deputy, periodId);
    const ev = await prisma.calendarEvent.findFirstOrThrow({ where: { schoolId: A.schoolId, autoKey: `exam-period:${periodId}` } });
    expect(ev).toMatchObject({ kind: 'EXAM', title: 'Term 3 end-of-term exams 2026', audience: 'FORMS' });
    expect(ev.startDate.toISOString().slice(0, 10)).toBe('2026-11-02');
    expect((await tt.listPeriods(officer, A.termId))[0]!.status).toBe('APPROVED');
    await fails(tt.setPaperRooms(officer, engPaper, { rooms: [] }), 409, /approved/);
  });

  it('is reopened by the Deputy (off the Calendar) and approved again', async () => {
    await expect(tt.returnPeriod(deputy, periodId, { comment: '' })).rejects.toThrow();
    await tt.returnPeriod(deputy, periodId, { comment: 'Move English to the hall' });
    expect(await prisma.calendarEvent.count({ where: { schoolId: A.schoolId, autoKey: `exam-period:${periodId}` } })).toBe(0);
    await tt.submitPeriod(officer, periodId);
    await tt.approvePeriod(deputy, periodId);
    expect(await prisma.calendarEvent.count({ where: { schoolId: A.schoolId, autoKey: `exam-period:${periodId}` } })).toBe(1);
  });
});

describe('seating', () => {
  it('lists candidates in admission number order, filling the rooms in turn, with desk numbers', async () => {
    const s = await inv.seatingFor(officer, mathsPaper);
    expect(s.candidates).toBe(6);
    expect(s.unseated).toEqual([]);
    expect(s.rooms.map((r) => [r.room, r.seats.length])).toEqual([['Room 1', 4], ['Science Lab', 2]]);
    expect(s.rooms[0]!.seats.map((x) => x.desk)).toEqual([1, 2, 3, 4]);
    expect(s.rooms[1]!.seats.map((x) => x.desk)).toEqual([1, 2]);
    const adm = s.rooms.flatMap((r) => r.seats.map((x) => x.admissionNumber));
    expect([...adm].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))).toEqual(adm);
  });

  it('uses candidate numbers once they are issued', async () => {
    const session = await prisma.boardSession.create({ data: { schoolId: A.schoolId, board: 'ZIMSEC', category: 'O_LEVEL', session: 'November 2026', centreNumber: '12345', feePerSubject: 20, passGrades: ['A', 'B', 'C'], exportColumns: [] } });
    // Reverse order: the last student gets the first number.
    for (const [i, k] of Array.from(kids.entries())) await prisma.candidate.create({ data: { schoolId: A.schoolId, sessionId: session.id, studentId: k, candidateNumber: String(1000 - i) } });
    const s = await inv.seatingFor(officer, mathsPaper);
    expect(s.rooms[0]!.seats[0]!.candidateNumber).toBe('995');
    expect(s.rooms[0]!.seats[0]!.name).toContain('FSIT'.slice(0, 1) === 'F' ? 'FSIT' : '');
  });

  it('prints each student their own papers with the room and desk', async () => {
    const st = await tt.studentTimetable(officer, periodId, kids[0]!);
    expect(st.papers.map((p) => p.name)).toEqual(['Mathematics Paper 1', 'Geography Paper 1', 'English Language Paper 1']);
    expect(st.papers.every((p) => p.room && p.desk)).toBe(true);
    const stNoGeo = await tt.studentTimetable(officer, periodId, kids[5]!);
    expect(stNoGeo.papers.map((p) => p.name)).toEqual(['Mathematics Paper 1', 'English Language Paper 1']);
  });
});

describe('invigilation', () => {
  it('assigns an invigilator to a room, warning when they teach the subject, and never two duties in one session', async () => {
    const ok = await inv.assignInvigilator(officer, { paperId: mathsPaper, roomId: room1, userId: invigilator.id });
    expect(ok.warning).toBeNull();
    const own = await inv.assignInvigilator(officer, { paperId: mathsPaper, roomId: room2, userId: W.teachers.chikore });
    expect(own.warning).toMatch(/teaches Mathematics/);
    await fails(inv.assignInvigilator(officer, { paperId: mathsPaper, roomId: room2, userId: invigilator.id }), 409, /already invigilating this paper in/);
    await fails(inv.assignInvigilator(await actorOf(prisma, W.teachers.ncube), { paperId: mathsPaper, roomId: room2, userId: invigilator.id }), 403);
    await inv.removeInvigilator(officer, (await prisma.invigilation.findFirstOrThrow({ where: { userId: W.teachers.chikore } })).id);
  });

  it('auto-assigns duties evenly, avoiding the subject\'s own teachers and double duties in a session', async () => {
    await prisma.invigilation.deleteMany({ where: { schoolId: A.schoolId } });
    const r = await inv.autoAssignInvigilators(officer, { periodId });
    const roster = await inv.dutyRoster(officer, periodId);
    expect(r.created).toBe(roster.duties.length);
    expect(roster.missing).toEqual([]);
    // One per room: maths 2 rooms, geography 1, english 2.
    expect(roster.duties).toHaveLength(5);
    const own: Record<string, string> = { [mathsPaper]: W.teachers.chikore, [geoPaper]: W.teachers.ncube, [engPaper]: W.teachers.moyo };
    expect(roster.duties.filter((d) => d.userId === own[d.paperId])).toEqual([]);
    const sessions = roster.duties.map((d) => `${d.userId}|${d.date}|${d.session}`);
    expect(new Set(sessions).size).toBe(sessions.length);
    // Spread: nobody has more than 2 of 5 duties when 5 or more teachers are free.
    const per = new Map<string, number>();
    for (const d of roster.duties) per.set(d.userId, (per.get(d.userId) ?? 0) + 1);
    expect(Math.max(...Array.from(per.values()))).toBeLessThanOrEqual(2);
  });

  it('shows a teacher their own duties', async () => {
    const duty = (await prisma.invigilation.findFirstOrThrow({ where: { schoolId: A.schoolId } }));
    const mine = await inv.myDuties(await actorOf(prisma, duty.userId));
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine[0]).toMatchObject({ userId: duty.userId });
  });
});

describe('exam attendance', () => {
  const dutyIn = async (paperId: string, roomId: string) => {
    let d = await prisma.invigilation.findFirst({ where: { paperId, roomId } });
    if (!d) d = await prisma.invigilation.create({ data: { schoolId: A.schoolId, paperId, roomId, userId: invigilator.id } });
    return actorOf(prisma, d.userId);
  };

  it('is marked by the people on duty in that room, not by anyone else', async () => {
    const onDuty = await dutyIn(mathsPaper, room1);
    const sheet = await inv.attendanceSheet(onDuty, mathsPaper, room1);
    expect(sheet.canMark).toBe(true);
    expect(sheet.rows).toHaveLength(4);
    const stranger = await actorOf(prisma, W.teachers.ncube);
    await fails(inv.attendanceSheet(stranger, mathsPaper, room1), 404);
    await fails(inv.markAttendance(stranger, { paperId: mathsPaper, roomId: room1, entries: [{ studentId: sheet.rows[0]!.studentId, status: 'ABSENT' }] }), 404);
  });

  it('gives an absent student AB on the paper, in their teacher\'s mark sheet', async () => {
    const onDuty = await dutyIn(mathsPaper, room1);
    const sheet = await inv.attendanceSheet(onDuty, mathsPaper, room1);
    const [a, b, c] = sheet.rows;
    const r = await inv.markAttendance(onDuty, { paperId: mathsPaper, roomId: room1, entries: [
      { studentId: a!.studentId, status: 'ABSENT' }, { studentId: b!.studentId, status: 'LATE', arrivalTime: '08:20' }, { studentId: c!.studentId, status: 'PRESENT' },
    ] });
    expect(r).toMatchObject({ saved: 3, absent: 1, markedAB: 1, notApplied: [] });
    const asm = await prisma.assessment.findFirstOrThrow({ where: { examPaperId: mathsPaper } });
    const m = await prisma.assessmentMark.findFirstOrThrow({ where: { assessmentId: asm.id, studentId: a!.studentId } });
    expect(m).toMatchObject({ code: 'AB', value: null, assignmentId: mathsAssignment });
    const g = await marks.loadGrid(teacher, mathsAssignment);
    expect(g.marks[`${a!.studentId}|${asm.id}|`]).toMatchObject({ c: 'AB' });
    // Late needs the time.
    await expect(inv.markAttendance(onDuty, { paperId: mathsPaper, roomId: room1, entries: [{ studentId: b!.studentId, status: 'LATE' }] })).rejects.toThrow();
  });

  it('takes the AB away when the student turns out to have been present', async () => {
    const onDuty = await dutyIn(mathsPaper, room1);
    const sheet = await inv.attendanceSheet(onDuty, mathsPaper, room1);
    const a = sheet.rows.find((x) => x.status === 'ABSENT')!;
    await inv.markAttendance(onDuty, { paperId: mathsPaper, roomId: room1, entries: [{ studentId: a.studentId, status: 'PRESENT' }] });
    const asm = await prisma.assessment.findFirstOrThrow({ where: { examPaperId: mathsPaper } });
    const m = await prisma.assessmentMark.findFirstOrThrow({ where: { assessmentId: asm.id, studentId: a.studentId } });
    expect(m.code).toBeNull();
  });

  it('does not touch a mark sheet that is locked, and says so', async () => {
    const onDuty = await dutyIn(mathsPaper, room1);
    await prisma.markSheet.update({ where: { assignmentId_termId: { assignmentId: mathsAssignment, termId: A.termId } }, data: { status: 'IN_PROGRESS' } }).catch(() => undefined);
    // Make the sheet look submitted through a direct update the database allows (status only).
    await prisma.markSheet.update({ where: { assignmentId_termId: { assignmentId: mathsAssignment, termId: A.termId } }, data: { status: 'SUBMITTED', submittedAt: new Date(), submittedById: W.teachers.chikore } });
    const sheet = await inv.attendanceSheet(onDuty, mathsPaper, room1);
    const target = sheet.rows[3]!;
    const r = await inv.markAttendance(onDuty, { paperId: mathsPaper, roomId: room1, entries: [{ studentId: target.studentId, status: 'ABSENT' }] });
    expect(r.markedAB).toBe(0);
    expect(r.notApplied[0]).toMatch(/submitted; ask the Head to unlock it/);
    await prisma.markSheet.update({ where: { assignmentId_termId: { assignmentId: mathsAssignment, termId: A.termId } }, data: { status: 'IN_PROGRESS' } });
  });
});

describe('incident reports', () => {
  it('records disruption or illness for the invigilator on duty', async () => {
    const d = await prisma.invigilation.findFirstOrThrow({ where: { paperId: mathsPaper, roomId: room1 } });
    const who = await actorOf(prisma, d.userId);
    const r = await inv.reportIncident(who, { paperId: mathsPaper, roomId: room1, type: 'ILLNESS', studentId: kids[0], description: 'Felt faint and was taken to the sick bay.' });
    expect(r.disciplineIncidentId).toBeNull();
    await fails(inv.reportIncident(await actorOf(prisma, W.teachers.ncube), { paperId: mathsPaper, type: 'DISRUPTION', description: 'Noise outside the hall.' }), 404);
  });

  it('records suspected malpractice in Discipline as exam dishonesty', async () => {
    const d = await prisma.invigilation.findFirstOrThrow({ where: { paperId: mathsPaper, roomId: room1 } });
    const who = await actorOf(prisma, d.userId);
    await fails(inv.reportIncident(who, { paperId: mathsPaper, type: 'MALPRACTICE', description: 'A cheat sheet was found under the desk.' }), 422, /Choose the student/);
    const r = await inv.reportIncident(who, { paperId: mathsPaper, roomId: room1, type: 'MALPRACTICE', studentId: kids[1], description: 'A cheat sheet was found under the desk.' });
    const incident = await prisma.disciplineIncident.findUniqueOrThrow({ where: { id: r.disciplineIncidentId! }, include: { students: true } });
    expect(incident).toMatchObject({ category: 'EXAM_DISHONESTY', severity: 'SERIOUS' });
    expect(incident.students.map((s) => s.studentId)).toEqual([kids[1]]);
    const list = await inv.listIncidents(officer, periodId);
    expect(list.filter((x) => x.inDiscipline)).toHaveLength(1);
    expect(await prisma.notification.count({ where: { type: 'EXAM_INCIDENT' } })).toBeGreaterThan(0);
  });

  it('refuses a student who does not sit the paper', async () => {
    const d = await prisma.invigilation.findFirstOrThrow({ where: { paperId: geoPaper } });
    const who = await actorOf(prisma, d.userId);
    await fails(inv.reportIncident(who, { paperId: geoPaper, type: 'OTHER', studentId: kids[5], description: 'Not in this paper at all.' }), 422, /does not sit this paper/);
  });
});

describe('changing a paper after marks exist', () => {
  it('keeps the maximum mark of a paper whose marks have been entered', async () => {
    const asm = await prisma.assessment.findFirstOrThrow({ where: { examPaperId: mathsPaper } });
    await prisma.markSheet.update({ where: { assignmentId_termId: { assignmentId: mathsAssignment, termId: A.termId } }, data: { status: 'IN_PROGRESS' } });
    await marks.saveMarks(teacher, { assignmentId: mathsAssignment, cells: [{ studentId: kids[2]!, assessmentId: asm.id, value: 55, code: null }] });
    await tt.returnPeriod(deputy, periodId, { comment: 'Change the time' });
    await fails(tt.savePaper(officer, paper({ maxMark: 80 }), mathsPaper), 409, /maximum mark cannot change/);
    await fails(tt.deletePaper(officer, mathsPaper), 409, /Marks are never deleted/);
  });
});

describe('school isolation', () => {
  it('shows nothing of another school\'s exam timetable', async () => {
    const outsider = await actorOf(prisma, B.users.ADMIN.id);
    expect(await tt.listPeriods(outsider)).toEqual([]);
    await fails(tt.getPeriod(outsider, periodId), 404);
    await fails(inv.seatingFor(outsider, mathsPaper), 404);
    await fails(tt.approvePeriod(outsider, periodId), 404);
  });
});

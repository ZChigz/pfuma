// @vitest-environment node
// The timetable: bell schedule and rooms, the builder and its clash rules (in the service and in the database), warnings,
// suggestions, checking and publishing with Head approval, versions, mid-term teacher changes, cover lessons, "My day" and
// per-lesson attendance with truancy.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { NOW, TODAY, addTeacher, assign, buildWorld, day, periodAt, sessionFor, students, type World } from '../helpers/academics';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let W: World;
let prisma: typeof import('@/lib/prisma').prisma;
let kids1: string[];
let f3: string[];
let a: Record<string, string>; // assignment ids
let groupAcc: string;
let groupPhy: string;
let deputy: string;
let deputyAs: Awaited<ReturnType<typeof sessionFor>>;

const admin = () => A.users.ADMIN;
const at = (ms: number) => new Date(NOW.getTime() - 3_600_000 + ms).toISOString();
const place = (assignmentId: string, d: number, no: number, o: object = {}, as = admin()) =>
  call('academics/timetable/place', 'POST', { as, body: { assignmentId, periodId: periodAt(W, d, no), ...o } });
const audit = (action: string) => prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: action as never } });

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  W = await buildWorld(prisma, A);
  kids1 = [A.studentId, ...(await students(prisma, A, W.f1North, 5, 'Kid'))];
  f3 = await students(prisma, A, W.f3North, 4, 'Three');
  deputy = await addTeacher(prisma, A, 'Deputy Dee', ['DEPUTY_HEAD']);
  for (const k of ['academics.timetable.edit', 'academics.timetable.cover', 'academics.timetable.view', 'academics.attendance.view']) await grantPermission(prisma, A.schoolId, 'DEPUTY_HEAD', k);
  await grantPermission(prisma, A.schoolId, 'HEAD', 'academics.timetable.approve');
  deputyAs = await sessionFor(prisma, deputy);

  // Form 3 electives: Accounts for students 0 and 1, Physics for students 1 and 2 (student 1 takes both).
  await call('academics/student-subjects/sync-core', 'POST', { as: admin(), body: {} });
  await call('academics/student-subjects', 'PUT', { as: admin(), body: { classId: W.f3North, changes: [
    { studentId: f3[0], subjectIds: [W.subjects.accounts] }, { studentId: f3[1], subjectIds: [W.subjects.accounts, W.subjects.physics] }, { studentId: f3[2], subjectIds: [W.subjects.physics] },
  ] } });
  groupAcc = (await call('academics/teaching-groups', 'POST', { as: admin(), body: { name: 'Form 3 Accounts', subjectId: W.subjects.accounts, levelId: W.form3 } })).json.data.id;
  groupPhy = (await call('academics/teaching-groups', 'POST', { as: admin(), body: { name: 'Form 3 Physics', subjectId: W.subjects.physics, levelId: W.form3 } })).json.data.id;

  const mk = async (key: string, d: Parameters<typeof assign>[2]) => { a = { ...(a ?? {}), [key]: (await assign(prisma, A, d)).id }; };
  await mk('maths1', { teacherId: W.teachers.chikore, subjectId: W.subjects.maths, classId: W.f1North, periods: 4, doubles: 1 });
  await mk('eng1', { teacherId: W.teachers.moyo, subjectId: W.subjects.english, classId: W.f1North, periods: 3 });
  await mk('sci1', { teacherId: W.teachers.ncube, subjectId: W.subjects.science, classId: W.f1North, periods: 2 });
  await mk('maths2', { teacherId: W.teachers.chikore, subjectId: W.subjects.maths, classId: W.f2East, periods: 3 });
  await mk('maths3', { teacherId: W.teachers.dube, subjectId: W.subjects.maths, classId: W.f3North, periods: 2 });
  const extra = await addTeacher(prisma, A, 'Mr Extra');
  await mk('acc', { teacherId: extra, subjectId: W.subjects.accounts, groupId: groupAcc, periods: 3 });
  await mk('phy', { teacherId: W.teachers.ncube, subjectId: W.subjects.physics, groupId: groupPhy, periods: 3 });
}, 240_000);

afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await t.stop();
});

describe('the bell schedule', () => {
  it('has periods for each day, with breaks as non-teaching slots, and a short Friday', async () => {
    const r = await call('academics/bell', 'GET', { as: admin() });
    expect(r.status).toBe(200);
    const bell = r.json.data.bell;
    expect(bell.days.map((d: { name: string }) => d.name)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
    expect(bell.days[0].periods.map((p: { type: string }) => p.type)).toContain('BREAK');
    expect(bell.days[4].periods.length).toBe(bell.days[0].periods.length - 1);
    expect(bell.saturday).toBe(false);
  });

  it('refuses periods that overlap or are out of order, and a schedule with no lessons', async () => {
    const day1 = (periods: object[]) => ({ days: [{ dayOfWeek: 1, periods }] });
    const put = (b: object) => call('academics/bell', 'PUT', { as: admin(), body: b });
    expect((await put(day1([{ periodNo: 1, start: '07:30', end: '08:10', type: 'LESSON' }, { periodNo: 2, start: '08:05', end: '08:40', type: 'LESSON' }]))).json.message).toMatch(/overlap/);
    expect((await put(day1([{ periodNo: 1, start: '08:30', end: '08:10', type: 'LESSON' }]))).json.message).toMatch(/must end after it starts/);
    expect((await put(day1([{ periodNo: 1, start: '07:30', end: '08:00', type: 'BREAK' }]))).json.message).toMatch(/at least one lesson period/);
    expect((await call('academics/bell', 'PUT', { as: A.users.TEACHER, body: day1([]) })).status).toBe(403);
  });

  it('adds Saturday teaching, which makes Saturday a school day (and a register day)', async () => {
    expect((await call('academics/attendance/view', 'GET', { as: admin(), query: `?classId=${W.f1North}&date=2026-10-17` })).json.data.schoolDay).toBe(false);
    const bell = (await call('academics/bell', 'GET', { as: admin() })).json.data.bell;
    const days = bell.days.map((d: { dayOfWeek: number; periods: { periodNo: number; start: string; end: string; type: string; label: string | null }[] }) => ({
      dayOfWeek: d.dayOfWeek, periods: d.periods.map((p) => ({ periodNo: p.periodNo, start: p.start, end: p.end, type: p.type, label: p.label })),
    }));
    days.push({ dayOfWeek: 6, periods: [{ periodNo: 1, start: '08:00', end: '08:40', type: 'LESSON', label: null }] });
    const r = await call('academics/bell', 'PUT', { as: admin(), body: { name: 'Bell schedule', days } });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ added: 1, changed: 0, removed: 0 });
    expect((await call('academics/attendance/view', 'GET', { as: admin(), query: `?classId=${W.f1North}&date=2026-10-17` })).json.data.schoolDay).toBe(true);
    // Take it away again: lessons on it would block this, but there are none.
    const back = await call('academics/bell', 'PUT', { as: admin(), body: { name: 'Bell schedule', days: days.slice(0, 5) } });
    expect(back.json.data.removed).toBe(1);
    expect((await call('academics/attendance/view', 'GET', { as: admin(), query: `?classId=${W.f1North}&date=2026-10-17` })).json.data.schoolDay).toBe(false);
    expect((await audit('SAVE_BELL_SCHEDULE')).length).toBe(2);
  });

  it('keeps a term\'s own schedule apart from the school\'s', async () => {
    const days = [{ dayOfWeek: 1, periods: [{ periodNo: 1, start: '08:00', end: '08:40', type: 'LESSON' }] }];
    const r = await call('academics/bell', 'PUT', { as: admin(), body: { termId: A.termId, name: 'Term 4 hours', days } });
    expect(r.status).toBe(200);
    const view = await call('academics/bell', 'GET', { as: admin(), query: `?termId=${A.termId}` });
    expect(view.json.data).toMatchObject({ hasTermSchedule: true });
    expect(view.json.data.bell.scope).toBe('TERM');
    expect((await call('academics/bell', 'DELETE', { as: admin(), query: `?termId=${A.termId}` })).status).toBe(200);
    expect((await call('academics/bell', 'GET', { as: admin(), query: `?termId=${A.termId}` })).json.data.bell.scope).toBe('SCHOOL');
  });
});

describe('rooms and teacher availability', () => {
  it('have a name, a type and a capacity', async () => {
    const r = await call('academics/rooms', 'POST', { as: admin(), body: { name: 'Computer Lab', type: 'COMPUTER_LAB', capacity: 30 } });
    expect(r.status).toBe(201);
    expect((await call('academics/rooms', 'POST', { as: admin(), body: { name: 'computer lab', type: 'CLASSROOM', capacity: 30 } })).status).toBe(409);
    expect((await call('academics/rooms', 'POST', { as: admin(), body: { name: 'Bad', type: 'CLASSROOM', capacity: 0 } })).status).toBe(422);
    expect((await call('academics/rooms', 'GET', { as: A.users.TEACHER })).status).toBe(200);
    expect((await call('academics/rooms', 'POST', { as: A.users.TEACHER, body: { name: 'Mine', type: 'HALL', capacity: 5 } })).status).toBe(403);
    expect((await call('academics/rooms/[id]', 'DELETE', { as: admin(), params: { id: r.json.data.room.id } })).status).toBe(200);
  });

  it('record the periods a teacher cannot teach', async () => {
    const r = await call('academics/availability/[id]', 'PUT', { as: admin(), params: { id: W.teachers.moyo }, body: { unavailable: [periodAt(W, 5, 1), periodAt(W, 5, 2)] } });
    expect(r.status).toBe(200);
    expect((await call('academics/availability/[id]', 'GET', { as: admin(), params: { id: W.teachers.moyo } })).json.data.unavailable).toHaveLength(2);
    expect((await call('academics/availability/[id]', 'PUT', { as: admin(), params: { id: W.teachers.moyo }, body: { unavailable: [periodAt(W, 1, 4)] } })).json.message).toMatch(/not a lesson period/);
    expect((await call('academics/availability/[id]', 'PUT', { as: admin(), params: { id: A.users.BURSAR.id }, body: { unavailable: [] } })).status).toBe(409);
  });
});

describe('placing lessons: the hard rules', () => {
  it('places a lesson in a free slot on a draft, copying the teacher and class onto it', async () => {
    const r = await place(a.maths1!, 1, 1, { roomId: W.rooms.room1 });
    expect(r.status).toBe(200);
    const slot = await prisma.timetableSlot.findFirstOrThrow({ where: { assignmentId: a.maths1 }, include: { timetable: true } });
    expect(slot).toMatchObject({ teacherId: W.teachers.chikore, classId: W.f1North, roomId: W.rooms.room1, isDouble: false });
    expect(slot.timetable).toMatchObject({ version: 1, status: 'DRAFT' });
    expect((await audit('PLACE_LESSON')).length).toBeGreaterThan(0);
  });

  it('does not let a teacher be in two lessons at once', async () => {
    const r = await place(a.maths2!, 1, 1);
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/Mr Tendai Chikore already teaches Maths to Form 1 North in Monday period 1/);
  });

  it('does not let a class have two lessons at once', async () => {
    const r = await place(a.eng1!, 1, 1);
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/Form 1 North already has Maths in Monday period 1/);
  });

  it('does not let a room hold two lessons at once', async () => {
    expect((await place(a.eng1!, 1, 2, { roomId: W.rooms.lab })).status).toBe(200);
    const r = await place(a.maths2!, 1, 2, { roomId: W.rooms.lab });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/Science Lab is already used by English for Form 1 North/);
  });

  it('does not let a double period run across a break', async () => {
    const r = await place(a.maths1!, 1, 3, { isDouble: true });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/can't run across a break/);
    const ok = await place(a.maths1!, 2, 5, { isDouble: true });
    expect(ok.status).toBe(200);
    const pair = await prisma.timetableSlot.findMany({ where: { assignmentId: a.maths1, isDouble: true }, orderBy: { createdAt: 'asc' } });
    expect(pair).toHaveLength(2);
    expect(pair[0]!.pairId).toBe(pair[1]!.pairId);
  });

  it('does not let a class get more periods of a subject than its assignment says', async () => {
    expect((await place(a.maths1!, 3, 1)).status).toBe(200); // 1 + 2 (double) + 1 = 4
    const r = await place(a.maths1!, 4, 1);
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/4 of 4 periods placed already/);
    expect((await place(a.maths2!, 4, 6, { isDouble: true })).json.message).toMatch(/has no double periods/);
  });

  it('keeps the same rules in the database, whatever the code does', async () => {
    const s = await prisma.timetableSlot.findFirstOrThrow({ where: { assignmentId: a.maths1 } });
    const insert = (id: string, teacher: string, cls: string | null, period: string, room: string | null, assignment = a.eng1!) =>
      t.pg.exec(`INSERT INTO "TimetableSlot" (id, "schoolId", "timetableId", "assignmentId", "periodId", "roomId", "teacherId", "classId", "updatedAt") VALUES ('${id}', '${A.schoolId}', '${s.timetableId}', '${assignment}', '${period}', ${room ? `'${room}'` : 'NULL'}, '${teacher}', ${cls ? `'${cls}'` : 'NULL'}, now())`);
    await expect(insert('x1', W.teachers.chikore, W.f2East, s.periodId, null)).rejects.toThrow(/TimetableSlot_teacher_per_period/);
    await expect(insert('x2', W.teachers.dube, W.f1North, s.periodId, null)).rejects.toThrow(/TimetableSlot_class_per_period/);
    await expect(insert('x3', W.teachers.dube, W.f2East, s.periodId, s.roomId)).rejects.toThrow(/TimetableSlot_room_per_period/);
    // Another version of the timetable may use the same period: the rules are per version.
    const other = await prisma.timetable.create({ data: { schoolId: A.schoolId, termId: A.termId, version: 99, status: 'SUPERSEDED', approvedById: admin().id, effectiveFrom: new Date('2026-09-01') } });
    await prisma.timetableSlot.create({ data: { schoolId: A.schoolId, timetableId: other.id, assignmentId: a.maths1!, periodId: s.periodId, teacherId: s.teacherId, classId: s.classId } });
    await prisma.timetable.delete({ where: { id: other.id } });
  });

  it('keeps a teaching group\'s students out of their own class\'s lessons, and out of a group they share', async () => {
    expect((await place(a.maths3!, 1, 5)).status).toBe(200); // Form 3 North maths, Monday period 5
    const clash = await place(a.acc!, 1, 5); // Accounts has students of Form 3 North
    expect(clash.status).toBe(409);
    expect(clash.json.message).toMatch(/Form 3 North already has Maths/);
    expect((await place(a.acc!, 2, 1)).status).toBe(200);
    const shared = await place(a.phy!, 2, 1); // Physics shares a student with Accounts
    expect(shared.status).toBe(409);
    expect(shared.json.message).toMatch(/Form 3 Accounts already has Accounts/);
    expect((await place(a.phy!, 2, 2)).status).toBe(200);
  });

  it('is for the Deputy: a teacher can look at their own week but cannot build', async () => {
    const chikore = await sessionFor(prisma, W.teachers.chikore);
    expect((await place(a.eng1!, 3, 2, {}, chikore)).status).toBe(403);
    expect((await place(a.eng1!, 3, 2, {}, deputyAs)).status).toBe(200);
    expect((await call('academics/timetable/view', 'GET', { as: chikore, query: '?view=master&version=working' })).status).toBe(404);
    const own = await call('academics/timetable/view', 'GET', { as: chikore, query: '?view=teacher&version=working' });
    expect(own.status).toBe(200);
    expect(own.json.data.timetable).toBeNull(); // readers see only the published one, and there is none yet
    expect((await call('academics/timetable/view', 'GET', { as: chikore, query: `?view=teacher&id=${W.teachers.moyo}` })).status).toBe(404);
  });

  it('does not let anyone build on a closed term', async () => {
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { status: 'CLOSED' } });
    const r = await place(a.eng1!, 4, 2);
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/closed/);
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { status: 'OPEN' } });
  });
});

describe('moving and removing lessons, warnings and suggestions', () => {
  it('moves a lesson to another slot in one step and removes a double as a pair', async () => {
    const slot = await prisma.timetableSlot.findFirstOrThrow({ where: { assignmentId: a.eng1, period: { dayOfWeek: 3 } } });
    const mv = await place(a.eng1!, 4, 1, { replaceSlotId: slot.id });
    expect(mv.status).toBe(200);
    expect(await prisma.timetableSlot.count({ where: { id: slot.id } })).toBe(0);
    expect(await prisma.timetableSlot.count({ where: { assignmentId: a.eng1 } })).toBe(2);
    // A move onto a clash leaves the lesson where it was.
    const bad = await place(a.eng1!, 1, 1, { replaceSlotId: (await prisma.timetableSlot.findFirstOrThrow({ where: { assignmentId: a.eng1, period: { dayOfWeek: 4 } } })).id });
    expect(bad.status).toBe(409);
    expect(await prisma.timetableSlot.count({ where: { assignmentId: a.eng1 } })).toBe(2);
    const dbl = await prisma.timetableSlot.findFirstOrThrow({ where: { assignmentId: a.maths1, isDouble: true } });
    const rm = await call('academics/timetable/slots/[id]', 'DELETE', { as: admin(), params: { id: dbl.id } });
    expect(rm.json.data.removed).toBe(2);
    expect((await audit('REMOVE_LESSON')).length).toBe(1);
    expect((await place(a.maths1!, 2, 5, { isDouble: true })).status).toBe(200); // put it back
  });

  it('warns, without stopping, about a practical subject outside a lab, a repeat in a day and an unavailable teacher', async () => {
    const r = await place(a.sci1!, 3, 5, { roomId: W.rooms.room1 });
    expect(r.status).toBe(200);
    expect(r.json.data.warnings.join()).toMatch(/Comb Sci is a practical subject and Room 1 is not a lab/);
    const again = await place(a.sci1!, 3, 6, { roomId: W.rooms.lab });
    expect(again.json.data.warnings.join()).toMatch(/already taught to Form 1 North on Wednesday/);
    const away = await place(a.eng1!, 5, 1);
    expect(away.status).toBe(200);
    expect(away.json.data.warnings.join()).toMatch(/Mrs Rudo Moyo is not available in Friday period 1/);
    await prisma.timetableSlot.deleteMany({ where: { assignmentId: a.eng1, period: { dayOfWeek: 5 } } });
  });

  it('suggests every slot where the lesson fits, and says why the others do not', async () => {
    const r = await call('academics/timetable/suggest', 'POST', { as: admin(), body: { assignmentId: a.maths2 } });
    expect(r.status).toBe(200);
    const slots = r.json.data.slots as { periodId: string; free: boolean; reasons: string[] }[];
    expect(slots.length).toBe(W.periods.filter((p) => p.type === 'LESSON').length);
    const monday1 = slots.find((s) => s.periodId === periodAt(W, 1, 1))!;
    expect(monday1.free).toBe(false);
    expect(monday1.reasons[0]).toMatch(/Mr Tendai Chikore already teaches/);
    const free = slots.filter((s) => s.free);
    expect(free.length).toBeGreaterThan(5);
    // Every slot it calls free really accepts the lesson.
    const probe = free[0]!;
    expect((await call('academics/timetable/place', 'POST', { as: admin(), body: { assignmentId: a.maths2, periodId: probe.periodId } })).status).toBe(200);
    await prisma.timetableSlot.deleteMany({ where: { assignmentId: a.maths2 } });
  });

  it('shows the class week with a "to place" list: "Maths, Mr Chikore, 4 of 4 periods placed"', async () => {
    const r = await call('academics/timetable/view', 'GET', { as: admin(), query: `?view=class&id=${W.f1North}&version=working` });
    expect(r.status).toBe(200);
    const d = r.json.data;
    expect(d.title).toBe('Form 1 North');
    expect(d.editable).toBe(true);
    const maths = d.toPlace.find((p: { shortName: string }) => p.shortName === 'Maths');
    expect(maths).toMatchObject({ teacher: 'Mr Tendai Chikore', placed: 4, needed: 4, doublesPlaced: 1, doublesNeeded: 1 });
    expect(d.toPlace.find((p: { shortName: string }) => p.shortName === 'English')).toMatchObject({ placed: 2, needed: 3 });
    expect(d.days[0].periods.length).toBe(7);
    expect(d.cells[periodAt(W, 1, 1)][0]).toMatchObject({ shortName: 'Maths', initials: 'TC', room: 'Room 1' });
    // A group lesson shows in the class week of the classes that have its students.
    const f3view = await call('academics/timetable/view', 'GET', { as: admin(), query: `?view=class&id=${W.f3North}&version=working` });
    expect(f3view.json.data.cells[periodAt(W, 2, 1)][0]).toMatchObject({ shortName: 'Accounts', isGroup: true });
    // The teacher, room and master views.
    const teacher = await call('academics/timetable/view', 'GET', { as: admin(), query: `?view=teacher&id=${W.teachers.chikore}&version=working` });
    expect(Object.keys(teacher.json.data.cells).length).toBeGreaterThan(2);
    const room = await call('academics/timetable/view', 'GET', { as: admin(), query: `?view=room&id=${W.rooms.lab}&version=working` });
    expect(Object.values(room.json.data.cells).flat().every((s) => (s as { room: string }).room === 'Science Lab')).toBe(true);
    const master = await call('academics/timetable/view', 'GET', { as: admin(), query: '?view=master&version=working' });
    expect(Object.values(master.json.data.cells).flat().length).toBeGreaterThan(8);
  });
});

describe('checking, approving and publishing', () => {
  it('will not send a timetable until every assignment is fully placed', async () => {
    const r = await call('academics/timetable/submit', 'POST', { as: deputyAs, body: {} });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/cannot be sent yet/);
    expect(r.json.message).toMatch(/Mathematics for Form 2 East \(Mr Tendai Chikore\): 0 of 3 periods placed|for Form 2 East/);
    const state = await call('academics/timetable', 'GET', { as: admin() });
    expect(state.json.data.working).toMatchObject({ version: 1, status: 'DRAFT' });
    expect(state.json.data.unplaced.length).toBeGreaterThan(0);
  });

  it('is sent, locked while it waits, and returned with a note', async () => {
    // Place everything that is left (the suggestions find a free slot for each lesson).
    for (const [key, rooms] of [['maths2', null], ['eng1', null], ['maths3', null], ['acc', null], ['phy', W.rooms.lab]] as const) {
      for (let guard = 0; guard < 8; guard++) {
        const st = await call('academics/timetable', 'GET', { as: admin() });
        const left = st.json.data.unplaced.find((u: { assignmentId: string }) => u.assignmentId === a[key]);
        if (!left) break;
        const sug = await call('academics/timetable/suggest', 'POST', { as: admin(), body: { assignmentId: a[key], roomId: rooms } });
        const slot = sug.json.data.slots.find((s: { free: boolean; warnings: string[] }) => s.free && s.warnings.length === 0) ?? sug.json.data.slots.find((s: { free: boolean }) => s.free);
        expect(slot, `a free slot for ${key}`).toBeTruthy();
        expect((await place(a[key]!, W.periods.find((p) => p.id === slot.periodId)!.day, W.periods.find((p) => p.id === slot.periodId)!.no, rooms ? { roomId: rooms } : {})).status).toBe(200);
      }
    }
    for (const key of Object.keys(a)) {
      const left = (await call('academics/timetable', 'GET', { as: admin() })).json.data.unplaced.find((u: { assignmentId: string }) => u.assignmentId === a[key]);
      expect(left, key).toBeUndefined();
    }
    const sent = await call('academics/timetable/submit', 'POST', { as: deputyAs, body: {} });
    expect(sent.status).toBe(200);
    expect(await prisma.timetable.findFirstOrThrow({ where: { termId: A.termId, version: 1 } })).toMatchObject({ status: 'PENDING', submittedById: deputy });
    // Locked while it waits.
    const locked = await place(a.eng1!, 5, 5);
    expect(locked.status).toBe(409);
    expect(locked.json.message).toMatch(/waiting for approval/);
    expect((await call('academics/timetable/submit', 'POST', { as: deputyAs, body: {} })).json.message).toMatch(/already waiting/);
    // The Head is told, the Deputy cannot approve, a return needs a note.
    expect(await prisma.notification.count({ where: { userId: A.users.HEAD.id, type: 'TIMETABLE' } })).toBe(1);
    expect((await call('academics/timetable/decide', 'POST', { as: deputyAs, body: { decision: 'APPROVE' } })).status).toBe(403);
    expect((await call('academics/timetable/decide', 'POST', { as: A.users.HEAD, body: { decision: 'RETURN' } })).status).toBe(422);
    expect((await call('academics/timetable/decide', 'POST', { as: A.users.HEAD, body: { decision: 'RETURN', note: 'Put Maths earlier in the day' } })).json.data.status).toBe('RETURNED');
    expect(await prisma.timetable.findFirstOrThrow({ where: { termId: A.termId, version: 1 } })).toMatchObject({ status: 'DRAFT' });
    expect(await prisma.notification.count({ where: { userId: deputy, title: 'The timetable was returned' } })).toBe(1);
    expect((await audit('RETURN_TIMETABLE')).length).toBe(1);
  });

  it('is published from an effective date; the approver is recorded and every teacher is told', async () => {
    await call('academics/timetable/submit', 'POST', { as: deputyAs, body: {} });
    const bad = await call('academics/timetable/decide', 'POST', { as: A.users.HEAD, body: { decision: 'APPROVE', effectiveFrom: '2027-03-01' } });
    expect(bad.status).toBe(422);
    const ok = await call('academics/timetable/decide', 'POST', { as: A.users.HEAD, body: { decision: 'APPROVE', effectiveFrom: '2026-10-05' } });
    expect(ok.json.data).toMatchObject({ status: 'PUBLISHED', version: 1, effectiveFrom: '2026-10-05' });
    expect(await prisma.timetable.findFirstOrThrow({ where: { termId: A.termId, version: 1 } })).toMatchObject({ status: 'PUBLISHED', approvedById: A.users.HEAD.id });
    for (const tch of [W.teachers.chikore, W.teachers.moyo, W.teachers.ncube, W.teachers.dube]) {
      expect(await prisma.notification.count({ where: { userId: tch, title: 'The timetable has been published' } }), tch).toBe(1);
    }
    expect((await audit('PUBLISH_TIMETABLE')).length).toBe(1);
    // The database keeps one published version per term.
    await expect(t.pg.exec(`INSERT INTO "Timetable" (id, "schoolId", "termId", version, status, "approvedById", "effectiveFrom", "updatedAt") VALUES ('p2', '${A.schoolId}', '${A.termId}', 7, 'PUBLISHED', '${admin().id}', '2026-11-01', now())`)).rejects.toThrow(/Timetable_one_published/);
  });

  it('cannot be edited once published: a new version is started instead, and older ones are kept', async () => {
    const slot = await prisma.timetableSlot.findFirstOrThrow({ where: { assignmentId: a.eng1 } });
    const rm = await call('academics/timetable/slots/[id]', 'DELETE', { as: admin(), params: { id: slot.id } });
    expect(rm.status).toBe(409);
    expect(rm.json.message).toMatch(/Published timetables cannot be edited/);
    const v2 = await call('academics/timetable/new-version', 'POST', { as: deputyAs, body: {} });
    expect(v2.status).toBe(201);
    expect(v2.json.data).toMatchObject({ version: 2, created: true });
    // It starts as a copy of version 1.
    expect(await prisma.timetableSlot.count({ where: { timetable: { version: 2, termId: A.termId } } })).toBe(await prisma.timetableSlot.count({ where: { timetable: { version: 1, termId: A.termId } } }));
    // Readers still see version 1; an editor sees both.
    const readers = await call('academics/timetable/view', 'GET', { as: A.users.TEACHER, query: `?view=teacher` });
    expect(readers.json.data.timetable).toMatchObject({ version: 1, status: 'PUBLISHED' });
    // Move a lesson in the new version, send it, publish it from next Monday.
    const s2 = await prisma.timetableSlot.findFirstOrThrow({ where: { assignmentId: a.eng1, timetable: { version: 2 } } });
    let moved = false;
    for (const p of W.periods.filter((x) => x.type === 'LESSON')) {
      const r = await place(a.eng1!, p.day, p.no, { replaceSlotId: s2.id });
      if (r.status === 200) { moved = true; break; }
    }
    expect(moved).toBe(true);
    expect((await call('academics/timetable/submit', 'POST', { as: deputyAs, body: {} })).status).toBe(200);
    const early = await call('academics/timetable/decide', 'POST', { as: A.users.HEAD, body: { decision: 'APPROVE', effectiveFrom: '2026-10-05' } });
    expect(early.status).toBe(422);
    expect(early.json.message).toMatch(/must start after the current one/);
    const pub = await call('academics/timetable/decide', 'POST', { as: A.users.HEAD, body: { decision: 'APPROVE', effectiveFrom: day(5) } });
    expect(pub.json.data.version).toBe(2);
    const versions = (await call('academics/timetable', 'GET', { as: admin() })).json.data.versions;
    expect(versions.map((v: { version: number; status: string }) => `${v.version}:${v.status}`)).toEqual(['2:PUBLISHED', '1:SUPERSEDED']);
    // Before the new date, version 1 is in force; from it, version 2.
    const current = await call('academics/timetable/view', 'GET', { as: admin(), query: `?view=class&id=${W.f1North}` });
    expect(current.json.data.timetable).toMatchObject({ version: 2, status: 'PUBLISHED' }); // the current published version; history is in the version list
    const old = await call('academics/timetable/view', 'GET', { as: admin(), query: `?view=class&id=${W.f1North}&version=1` });
    expect(old.json.data.timetable).toMatchObject({ version: 1, status: 'SUPERSEDED' });
  });
});

describe('a teacher changed in the middle of a term', () => {
  it('follows through when the new teacher is free: the published week shows the new teacher from the date, and "My day" with it', async () => {
    const free = await addTeacher(prisma, A, 'Mr Spare');
    const effective = day(7); // Wednesday 21 October
    const r = await call('academics/assignments/[id]/replace', 'POST', { as: admin(), params: { id: a.maths1 }, body: { teacherId: free, effectiveDate: effective } });
    expect(r.status).toBe(200);
    const newId = r.json.data.id;
    // No draft exists, so the published slots keep pointing at the old assignment; the readers resolve by date.
    const onDate = await call('academics/timetable/view', 'GET', { as: admin(), query: `?view=class&id=${W.f1North}&date=${effective}` });
    expect(Object.values(onDate.json.data.cells).flat().filter((s) => (s as { shortName: string }).shortName === 'Maths').every((s) => (s as { teacher: string }).teacher === 'Mr Spare')).toBe(true);
    const beforeDate = await call('academics/timetable/view', 'GET', { as: admin(), query: `?view=class&id=${W.f1North}&date=${day(3)}` });
    expect(Object.values(beforeDate.json.data.cells).flat().filter((s) => (s as { shortName: string }).shortName === 'Maths').every((s) => (s as { teacher: string }).teacher === 'Mr Tendai Chikore')).toBe(true);
    const spareAs = await sessionFor(prisma, free);
    const md = await call('academics/timetable/my-day', 'GET', { as: spareAs, query: `?date=${effective}` });
    expect(md.json.data.lessons.length).toBeGreaterThan(0);
    expect(md.json.data.lessons.every((l: { subject: string }) => l.subject === 'Maths')).toBe(true);
    const old = await call('academics/timetable/my-day', 'GET', { as: await sessionFor(prisma, W.teachers.chikore), query: `?date=${effective}` });
    expect(old.json.data.lessons.every((l: { target: string }) => l.target !== 'Form 1 North')).toBe(true);
    // A new version started now follows the new teacher.
    await call('academics/timetable/new-version', 'POST', { as: admin(), body: {} });
    const copied = await prisma.timetableSlot.findMany({ where: { timetable: { termId: A.termId, status: 'DRAFT' }, assignmentId: newId } });
    expect(copied.length).toBe(4);
    expect(copied.every((s) => s.teacherId === free)).toBe(true);
    // Back to the published one for the cover tests: drop the draft.
    await prisma.timetableSlot.deleteMany({ where: { timetable: { termId: A.termId, status: 'DRAFT' } } });
    await prisma.timetable.deleteMany({ where: { termId: A.termId, status: 'DRAFT' } });
  });
});

describe('My day', () => {
  it('lists the teacher\'s lessons for the day with the next one marked', async () => {
    const mrsMoyo = await sessionFor(prisma, W.teachers.moyo);
    const r = await call('academics/timetable/my-day', 'GET', { as: mrsMoyo, query: `?date=${day(1)}` });
    expect(r.status).toBe(200);
    expect(r.json.data.schoolDay).toBe(true);
    const lessons = r.json.data.lessons as { start: string; end: string; subject: string }[];
    expect(lessons.every((l, i) => i === 0 || lessons[i - 1]!.start < l.start)).toBe(true);
    expect(r.json.data.nextIndex).toBe(-1); // not today
    const today = await call('academics/timetable/my-day', 'GET', { as: mrsMoyo });
    for (const l of today.json.data.lessons) expect(typeof l.subject).toBe('string');
    if (today.json.data.lessons.length) {
      const idx = today.json.data.nextIndex;
      expect(idx).toBe(today.json.data.lessons.findIndex((l: { end: string }) => l.end > '10:00')); // it is 10:00 in Harare
    }
    expect((await call('academics/timetable/my-day', 'GET', { as: mrsMoyo, query: '?date=2026-10-17' })).json.data).toMatchObject({ schoolDay: false, lessons: [] });
  });
});

describe('cover lessons', () => {
  const cover = (q: string, as = deputyAs) => call('academics/timetable/cover', 'GET', { as, query: q });
  const tomorrow = () => day(1); // Thursday 15 October

  it('lists the absent teacher\'s lessons with the free teachers, fewest covers first', async () => {
    const r = await cover(`?date=${tomorrow()}&teacherId=${W.teachers.moyo}`);
    expect(r.status).toBe(200);
    const lessons = r.json.data.lessons;
    expect(lessons.length).toBeGreaterThan(0);
    for (const l of lessons) {
      expect(l.free.map((x: { id: string }) => x.id)).not.toContain(W.teachers.moyo);
      const covers = l.free.map((x: { covers: number }) => x.covers);
      expect(covers).toEqual([...covers].sort((x: number, y: number) => x - y));
    }
    expect((await cover(`?date=${tomorrow()}&teacherId=${W.teachers.moyo}`, A.users.TEACHER)).status).toBe(403);
    expect((await cover('?date=2026-10-17&teacherId=' + W.teachers.moyo)).status).toBe(409);
  });

  it('assigns a free teacher, tells them, and ranks them lower afterwards', async () => {
    const r = await cover(`?date=${tomorrow()}&teacherId=${W.teachers.moyo}`);
    const lesson = r.json.data.lessons[0];
    const pick = lesson.free.find((x: { id: string }) => x.id !== deputy);
    const ok = await call('academics/timetable/cover', 'POST', { as: deputyAs, body: { date: tomorrow(), slotId: lesson.slotId, coverTeacherId: pick.id } });
    expect(ok.status).toBe(201);
    expect(await prisma.notification.count({ where: { userId: pick.id, type: 'COVER' } })).toBe(1);
    expect((await audit('ASSIGN_COVER')).length).toBe(1);
    const again = await cover(`?date=${tomorrow()}&teacherId=${W.teachers.moyo}`);
    expect(again.json.data.lessons.find((l: { slotId: string }) => l.slotId === lesson.slotId).covered).toMatchObject({ teacherId: pick.id });
    for (const l of again.json.data.lessons.filter((x: { slotId: string }) => x.slotId !== lesson.slotId)) {
      const mine = l.free.find((x: { id: string }) => x.id === pick.id);
      if (mine) expect(mine.covers).toBe(1);
    }
    // Their own My day shows the cover.
    const md = await call('academics/timetable/my-day', 'GET', { as: await sessionFor(prisma, pick.id), query: `?date=${tomorrow()}` });
    expect(md.json.data.lessons.some((l: { isCover: boolean; coverFor: string }) => l.isCover && l.coverFor === 'Mrs Rudo Moyo')).toBe(true);
    // The daily cover list for the staff room.
    const list = await call('academics/timetable/cover-list', 'GET', { as: A.users.TEACHER, query: `?date=${tomorrow()}` });
    expect(list.json.data.rows).toHaveLength(1);
    expect(list.json.data.rows[0]).toMatchObject({ absent: 'Mrs Rudo Moyo' });
  });

  it('refuses a cover teacher who is teaching then, the absent teacher, a past day and a non-teacher', async () => {
    const r = await cover(`?date=${tomorrow()}&teacherId=${W.teachers.moyo}`);
    const lesson = r.json.data.lessons[0];
    // Make Mr Dube teach in that period (straight into the timetable), so he cannot cover it.
    const slot = await prisma.timetableSlot.findUniqueOrThrow({ where: { id: lesson.slotId } });
    const dubeThere = await prisma.timetableSlot.findFirst({ where: { timetableId: slot.timetableId, periodId: slot.periodId, teacherId: W.teachers.dube } });
    if (!dubeThere) {
      const free = await prisma.timetableSlot.findFirst({ where: { timetableId: slot.timetableId, periodId: slot.periodId, classId: W.f3North } });
      if (free) await prisma.timetableSlot.delete({ where: { id: free.id } });
      await prisma.timetableSlot.create({ data: { schoolId: A.schoolId, timetableId: slot.timetableId, assignmentId: a.maths3!, periodId: slot.periodId, teacherId: W.teachers.dube, classId: W.f3North } });
    }
    const busy = { teacherId: W.teachers.dube };
    const post = (b: object) => call('academics/timetable/cover', 'POST', { as: deputyAs, body: { date: tomorrow(), slotId: lesson.slotId, ...b } });
    expect((await post({ coverTeacherId: busy.teacherId })).json.message).toMatch(/is teaching in that period/);
    expect((await post({ coverTeacherId: W.teachers.moyo })).json.message).toMatch(/someone else/);
    expect((await post({ coverTeacherId: A.users.BURSAR.id })).json.message).toMatch(/active teacher/);
    expect((await call('academics/timetable/cover', 'POST', { as: deputyAs, body: { date: day(-1), slotId: lesson.slotId, coverTeacherId: W.teachers.dube } })).status).toBe(422);
    expect((await call('academics/timetable/cover', 'POST', { as: A.users.TEACHER, body: { date: tomorrow(), slotId: lesson.slotId, coverTeacherId: W.teachers.dube } })).status).toBe(403);
  });

  it('can be taken back', async () => {
    const row = await prisma.coverLesson.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    expect((await call('academics/timetable/cover/[id]', 'DELETE', { as: deputyAs, params: { id: row.id } })).status).toBe(200);
    expect(await prisma.coverLesson.count({ where: { schoolId: A.schoolId } })).toBe(0);
  });
});

describe('per-lesson attendance', () => {
  let slotId: string;
  let date: string;
  let moyo: Awaited<ReturnType<typeof sessionFor>>;
  const lessonBody = (entries: object[], o: object = {}) => ({ slotId, date, entries, changedAt: at(0), correctionReason: 'Lesson register', ...o });

  it('is off until the school switches it on', async () => {
    moyo = await sessionFor(prisma, W.teachers.moyo);
    expect((await call('academics/attendance/lessons', 'GET', { as: moyo })).json.data.enabled).toBe(false);
    expect((await call('academics/attendance/lesson', 'GET', { as: moyo, query: `?slotId=x&date=${TODAY}` })).json.message).toMatch(/switched off/);
    await prisma.academicsSettings.upsert({ where: { schoolId: A.schoolId }, update: { perLessonAttendance: true }, create: { schoolId: A.schoolId, perLessonAttendance: true } });
  });

  it('opens a register for each lesson of the teacher, for the students who take the subject', async () => {
    // One of Mrs Moyo's English lessons in the published timetable on Monday to Wednesday of this week.
    const tt = await prisma.timetable.findFirstOrThrow({ where: { termId: A.termId, version: 1 } });
    const s = await prisma.timetableSlot.findFirstOrThrow({ where: { timetableId: tt.id, assignmentId: a.eng1, period: { dayOfWeek: { in: [1, 2, 3] } } }, include: { period: true } });
    slotId = s.id;
    date = day(s.period.dayOfWeek - 3); // Monday 12, Tuesday 13 or Wednesday 14 October
    const lessons = await call('academics/attendance/lessons', 'GET', { as: moyo, query: `?date=${date}` });
    expect(lessons.json.data.enabled).toBe(true);
    const l = lessons.json.data.lessons.find((x: { slotId: string }) => x.slotId === slotId);
    expect(l).toMatchObject({ subject: 'English', target: 'Form 1 North', marked: false });
    const sheet = await call('academics/attendance/lesson', 'GET', { as: moyo, query: `?slotId=${slotId}&date=${date}` });
    expect(sheet.status).toBe(200);
    expect(sheet.json.data).toMatchObject({ kind: 'LESSON', canMark: expect.any(Boolean), editMode: expect.any(String) });
    expect(sheet.json.data.students).toHaveLength(6); // English is core in Form 1: everyone
    // A teacher who does not teach the lesson cannot open it, and it must be a day the lesson is on.
    expect((await call('academics/attendance/lesson', 'GET', { as: await sessionFor(prisma, W.teachers.ncube), query: `?slotId=${slotId}&date=${date}` })).status).toBe(404);
    const otherDay = day(s.period.dayOfWeek === 3 ? -2 : -1);
    if (otherDay !== date) expect((await call('academics/attendance/lesson', 'GET', { as: moyo, query: `?slotId=${slotId}&date=${otherDay}` })).status).toBe(422);
  });

  it('flags a student who was present in the morning but is absent from a lesson as a possible truant', async () => {
    // Morning register that day: kid 2 is absent all day, the others are present (so kid 3 is the truant).
    const mark = await call('academics/attendance/register', 'PUT', { as: admin(), body: { classId: W.f1North, date, session: 'AM', entries: [{ studentId: kids1[2], status: 'ABSENT', reason: 'SICK' }], changedAt: at(0), correctionReason: 'Back-fill for the test' } });
    expect(mark.status).toBe(200);
    const r = await call('academics/attendance/lesson', 'PUT', { as: moyo, body: lessonBody([{ studentId: kids1[2], status: 'ABSENT' }, { studentId: kids1[3], status: 'ABSENT' }, { studentId: kids1[4], status: 'EXCUSED', reason: 'SICK' }]) });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ outcome: 'created', absent: 2, excused: 1 });
    const reg = await prisma.attendanceRegister.findFirstOrThrow({ where: { slotId, date: new Date(date) } });
    expect(reg).toMatchObject({ session: 'LESSON', classId: W.f1North, markedById: W.teachers.moyo });
    const flagged = await call('academics/attendance/truancy', 'GET', { as: admin(), query: `?date=${date}` });
    const names = flagged.json.data.flagged.map((f: { studentId: string }) => f.studentId);
    expect(names).toEqual([kids1[3]]); // kid 2 was absent in the morning too; kid 4 is excused
    expect(flagged.json.data.flagged[0]).toMatchObject({ className: 'Form 1 North', lesson: expect.stringMatching(/English/) });
    const note = await prisma.notification.findMany({ where: { type: 'TRUANCY', schoolId: A.schoolId } });
    expect(note.length).toBeGreaterThan(0);
    expect(new Set(note.map((n) => n.userId)).has(deputy)).toBe(true);
    expect(note[0]!.title).toMatch(/Possible truancy/);
    // The lesson register is a register of its own: the morning one is untouched.
    expect(await prisma.attendanceRegister.count({ where: { classId: W.f1North, date: new Date(date), session: 'AM' } })).toBe(1);
  });

  it('is one register per lesson per day; a later day needs a reason; another teacher cannot mark it, a cover teacher can', async () => {
    expect((await call('academics/attendance/lesson', 'PUT', { as: moyo, body: lessonBody([{ studentId: kids1[3], status: 'PRESENT' }], { correctionReason: undefined, changedAt: at(60_000) }) })).status).toBe(422); // an earlier day: a reason is needed
    const ok = await call('academics/attendance/lesson', 'PUT', { as: moyo, body: lessonBody([{ studentId: kids1[3], status: 'PRESENT' }], { changedAt: at(120_000) }) });
    expect(ok.json.data.outcome).toBe('updated');
    expect(await prisma.attendanceRegister.count({ where: { slotId, date: new Date(date) } })).toBe(1);
    expect((await call('academics/attendance/lesson', 'PUT', { as: await sessionFor(prisma, W.teachers.ncube), body: lessonBody([]) })).status).toBe(422);
    expect((await call('academics/attendance/lesson', 'PUT', { as: await sessionFor(prisma, W.teachers.ncube), body: lessonBody([{ studentId: kids1[3], status: 'ABSENT' }]) })).status).toBe(404);
  });
});

describe('another school', () => {
  it('cannot see or change this school\'s timetable', async () => {
    const slot = await prisma.timetableSlot.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    expect((await call('academics/timetable/slots/[id]', 'DELETE', { as: B.users.ADMIN, params: { id: slot.id } })).status).toBe(404);
    expect((await call('academics/timetable/place', 'POST', { as: B.users.ADMIN, body: { assignmentId: a.eng1, periodId: periodAt(W, 5, 5) } })).status).toBe(404);
    expect((await call('academics/timetable/view', 'GET', { as: B.users.ADMIN, query: `?view=class&id=${W.f1North}` })).status).toBe(404);
    expect((await call('academics/timetable', 'GET', { as: B.users.ADMIN })).json.data.working).toBeNull();
  });
});

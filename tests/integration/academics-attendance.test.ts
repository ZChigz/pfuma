// @vitest-environment node
// The attendance register: marking in under a minute (everyone starts present), school days only, the correction window,
// locks for suspended students, offline sync with the latest change winning, alerts, and the Head's daily summary.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { NOW, TODAY, addTeacher, buildWorld, day, sessionFor, students, type World } from '../helpers/academics';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let W: World;
let prisma: typeof import('@/lib/prisma').prisma;
let kids: string[]; // Form 1 North: the seeded student and five more, by surname
let classTeacher: Awaited<ReturnType<typeof sessionFor>>;
let otherTeacher: Awaited<ReturnType<typeof sessionFor>>;
let deputy: string;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  W = await buildWorld(prisma, A);
  kids = [A.studentId, ...(await students(prisma, A, W.f1North, 5, 'Kid'))];
  await students(prisma, A, W.f2East, 3, 'Other');
  await call('academics/classes/[id]/class-teacher', 'PUT', { as: A.operator!, params: { id: W.f1North }, body: { userId: W.teachers.chikore } });
  await call('academics/classes/[id]/class-teacher', 'PUT', { as: A.operator!, params: { id: W.f2East }, body: { userId: W.teachers.moyo } });
  classTeacher = await sessionFor(prisma, W.teachers.chikore);
  otherTeacher = await sessionFor(prisma, W.teachers.ncube);
  deputy = await addTeacher(prisma, A, 'Deputy Dee', ['DEPUTY_HEAD']);
  await prisma.calendarEvent.create({ data: { schoolId: A.schoolId, title: 'Test holiday', kind: 'PUBLIC_HOLIDAY', startDate: new Date('2026-10-09'), endDate: new Date('2026-10-09'), createdById: A.operator!.id } });
}, 180_000);

afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await t.stop();
});

/** A moment on Wednesday morning, an hour before 'now' plus some milliseconds, so later saves are later changes and none is in the future. */
const at = (ms: number) => new Date(NOW.getTime() - 3_600_000 + ms).toISOString();
const reg = (as: typeof classTeacher | null, body: object, method: 'PUT' | 'GET' = 'PUT', query = '') =>
  call('academics/attendance/register', method, { as, body: method === 'PUT' ? body : undefined, query });
const mark = (entries: object[], o: object = {}) => ({ classId: W.f1North, date: TODAY, session: 'AM', entries, changedAt: at(0), ...o });
const registers = () => prisma.attendanceRegister.findMany({ where: { schoolId: A.schoolId, classId: W.f1North }, include: { entries: true }, orderBy: { date: 'asc' } });
const audit = (action: string) => prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: action as never }, orderBy: { createdAt: 'asc' } });
const statusOf = async (date: string, studentId: string) =>
  (await prisma.attendanceEntry.findFirst({ where: { studentId, register: { date: new Date(date), classId: W.f1North, session: 'AM' } } }))?.status;

describe('the sheet the class teacher opens', () => {
  it('lists the class from the Enrollment with everyone Present, and says who may mark it', async () => {
    const r = await reg(classTeacher, null, 'GET', `?classId=${W.f1North}`);
    expect(r.status).toBe(200);
    const s = r.json.data;
    expect(s).toMatchObject({ className: 'Form 1 North', date: TODAY, session: 'AM', schoolDay: true, editMode: 'FREE', canMark: true, register: null });
    expect(s.students).toHaveLength(6);
    expect(s.students.every((x: { status: string; locked: boolean }) => x.status === 'PRESENT' && !x.locked)).toBe(true);
    const surnames = s.students.map((x: { fullName: string }) => x.fullName);
    expect(surnames).toEqual([...surnames].sort((a: string, b: string) => a.split(' ').pop()!.localeCompare(b.split(' ').pop()!)));
    expect(s.sessions).toEqual(['AM']);
  });

  it('is empty, with the reason, on a weekend, a public holiday or a day outside the term', async () => {
    const sat = await reg(classTeacher, null, 'GET', `?classId=${W.f1North}&date=2026-10-17`);
    expect(sat.json.data).toMatchObject({ schoolDay: false, canMark: false, students: [] });
    expect(sat.json.data.noSchoolReason).toMatch(/weekend/);
    expect((await reg(classTeacher, null, 'GET', `?classId=${W.f1North}&date=2026-10-09`)).json.data.noSchoolReason).toMatch(/public holiday/);
    expect((await reg(classTeacher, null, 'GET', `?classId=${W.f1North}&date=2026-08-20`)).json.data.noSchoolReason).toMatch(/outside the term/);
  });

  it('is not shown to a teacher of another class (as if the class is not there)', async () => {
    expect((await reg(otherTeacher, null, 'GET', `?classId=${W.f1North}`)).status).toBe(404);
    expect((await reg(null, null, 'GET', `?classId=${W.f1North}`)).status).toBe(401);
    expect((await reg(await sessionFor(prisma, B.users.TEACHER.id), null, 'GET', `?classId=${W.f1North}`)).status).toBe(404);
  });
});

describe('marking the register', () => {
  it('saves only the exceptions; everyone else is present', async () => {
    const r = await reg(classTeacher, mark([
      { studentId: kids[1], status: 'ABSENT' },
      { studentId: kids[2], status: 'LATE', arrivalTime: '08:12' },
      { studentId: kids[3], status: 'EXCUSED', reason: 'SICK' },
    ]));
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ outcome: 'created', present: 3, late: 1, absent: 1, excused: 1 });
    const [row] = await registers();
    expect(row!.entries).toHaveLength(6);
    expect(row).toMatchObject({ session: 'AM', markedById: W.teachers.chikore, slotId: null });
    expect(row!.entries.find((e) => e.studentId === kids[2])).toMatchObject({ status: 'LATE', arrivalTime: '08:12' });
    expect(row!.entries.find((e) => e.studentId === kids[3])).toMatchObject({ status: 'EXCUSED', reason: 'SICK' });
    expect((await audit('MARK_REGISTER')).length).toBe(1);
    expect((await audit('MARK_REGISTER'))[0]!.detail).toMatch(/Form 1 North, Wed 14 Oct, morning: register marked \(1 absent, 1 late, 1 excused\)/);
  });

  it('shows the saved marks when it is opened again', async () => {
    const s = (await reg(classTeacher, null, 'GET', `?classId=${W.f1North}`)).json.data;
    expect(s.register.markedBy).toBe('Mr Tendai Chikore');
    expect(s.students.filter((x: { status: string }) => x.status !== 'PRESENT')).toHaveLength(3);
  });

  it('may be changed freely on the same day and is saved once, not twice', async () => {
    const r = await reg(classTeacher, mark([{ studentId: kids[1], status: 'PRESENT' }, { studentId: kids[3], status: 'EXCUSED', reason: 'SICK' }], { changedAt: at(60_000) }));
    expect(r.json.data).toMatchObject({ outcome: 'updated', absent: 0 });
    expect(await prisma.attendanceRegister.count({ where: { classId: W.f1North } })).toBe(1);
    expect(await statusOf(TODAY, kids[1]!)).toBe('PRESENT');
    expect(await statusOf(TODAY, kids[2]!)).toBe('PRESENT'); // not repeated in the new list, so present again
  });

  it('does nothing when the same register is sent again', async () => {
    const body = mark([{ studentId: kids[3], status: 'EXCUSED', reason: 'SICK' }], { changedAt: at(60_000) });
    const before = (await audit('MARK_REGISTER')).length;
    expect((await reg(classTeacher, body)).json.data.outcome).toBe('unchanged');
    expect((await audit('MARK_REGISTER')).length).toBe(before);
  });

  it('refuses another teacher, a visitor and a future day, and takes the admin for any class', async () => {
    expect((await reg(otherTeacher, mark([{ studentId: kids[1], status: 'ABSENT' }]))).status).toBe(404);
    expect((await reg(null, mark([]))).status).toBe(401);
    expect((await reg(classTeacher, mark([{ studentId: kids[1], status: 'ABSENT' }], { date: day(1) }))).json.message).toMatch(/has not come yet/);
    expect((await reg(A.operator!, mark([{ studentId: kids[4], status: 'ABSENT' }], { changedAt: at(120_000) }))).status).toBe(200);
    expect(await statusOf(TODAY, kids[4]!)).toBe('ABSENT');
  });

  it('refuses days that are not school days', async () => {
    expect((await reg(classTeacher, mark([{ studentId: kids[1], status: 'ABSENT' }], { date: '2026-10-10' }))).json.message).toMatch(/weekend/);
    expect((await reg(classTeacher, mark([{ studentId: kids[1], status: 'ABSENT' }], { date: '2026-10-09' }))).json.message).toMatch(/public holiday/);
    expect((await reg(classTeacher, mark([{ studentId: kids[1], status: 'ABSENT' }], { date: '2026-08-20' }))).json.message).toMatch(/outside the term/);
  });

  it('checks each mark: a late student needs a time, an excused one a reason, and no strangers', async () => {
    expect((await reg(classTeacher, mark([{ studentId: kids[1], status: 'LATE' }]))).status).toBe(422);
    expect((await reg(classTeacher, mark([{ studentId: kids[1], status: 'EXCUSED' }]))).status).toBe(422);
    expect((await reg(classTeacher, mark([{ studentId: kids[1], status: 'PRESENT', reason: 'SICK' }]))).status).toBe(422);
    expect((await reg(classTeacher, mark([{ studentId: 'nobody', status: 'ABSENT' }]))).json.message).toMatch(/not in this register/);
    expect((await reg(classTeacher, mark([{ studentId: kids[1], status: 'ABSENT' }, { studentId: kids[1], status: 'LATE', arrivalTime: '08:00' }]))).json.message).toMatch(/twice/);
    expect((await reg(classTeacher, mark([]))).status).toBe(422);
  });

  it('takes an afternoon register only when the school has switched it on', async () => {
    expect((await reg(classTeacher, mark([{ studentId: kids[1], status: 'ABSENT' }], { session: 'PM' }))).json.message).toMatch(/does not take an afternoon register/);
    await prisma.academicsSettings.update({ where: { schoolId: A.schoolId }, data: { afternoonRegister: true } });
    expect((await reg(classTeacher, null, 'GET', `?classId=${W.f1North}&session=PM`)).json.data.sessions).toEqual(['AM', 'PM']);
    expect((await reg(classTeacher, mark([{ studentId: kids[1], status: 'ABSENT' }], { session: 'PM' }))).status).toBe(200);
    expect(await prisma.attendanceRegister.count({ where: { classId: W.f1North, session: 'PM' } })).toBe(1);
    await prisma.academicsSettings.update({ where: { schoolId: A.schoolId }, data: { afternoonRegister: false } });
  });
});

describe('changing a register after its day', () => {
  it('needs a reason, and logs it', async () => {
    const yesterday = day(-1);
    const body = (o: object = {}) => mark([{ studentId: kids[1], status: 'ABSENT' }], { date: yesterday, ...o });
    const no = await reg(classTeacher, body());
    expect(no.status).toBe(422);
    expect(no.json.message).toMatch(/Give a reason/);
    const yes = await reg(classTeacher, body({ correctionReason: 'Forgot to mark yesterday' }));
    expect(yes.status).toBe(200);
    expect(yes.json.data.outcome).toBe('created');
    const log = (await audit('CORRECT_REGISTER')).at(-1)!;
    expect(log.detail).toMatch(/Forgot to mark yesterday/);
    // A change to it needs a reason again.
    const change = await reg(classTeacher, mark([{ studentId: kids[1], status: 'PRESENT' }], { date: yesterday, changedAt: at(300_000) }));
    expect(change.status).toBe(422);
  });

  it('is for the Deputy once it is more than 7 days old', async () => {
    const old = '2026-10-05';
    const r = await reg(classTeacher, mark([{ studentId: kids[1], status: 'ABSENT' }], { date: old, correctionReason: 'Found the paper register' }));
    expect(r.status).toBe(403);
    expect(r.json.message).toMatch(/can only be changed by the Deputy/);
    expect(await prisma.attendanceRegister.count({ where: { classId: W.f1North, date: new Date(old) } })).toBe(0);
    // A Deputy who holds academics.attendance.correct (and attendance.mark) may, with a reason.
    await grantPermission(prisma, A.schoolId, 'DEPUTY_HEAD', 'academics.attendance.correct');
    const dep = await sessionFor(prisma, deputy);
    const ok = await call('academics/attendance/correct', 'PUT', { as: dep, body: mark([{ studentId: kids[1], status: 'ABSENT' }], { date: old, correctionReason: 'Found the paper register' }) });
    expect(ok.status).toBe(200); // the Deputy is not the class teacher, and needs only the correct permission
    expect((await call('academics/attendance/correct', 'PUT', { as: classTeacher, body: mark([], { date: old }) })).status).toBe(403);
  });

  it('is judged by the day a phone recorded it, so a register marked offline and sent the next day is still same-day', async () => {
    const tuesday = day(-1);
    const r = await call('academics/attendance/sync', 'POST', {
      as: classTeacher,
      body: { registers: [{ ref: 'offline-1', classId: W.f2East, date: tuesday, session: 'AM', entries: [{ studentId: (await prisma.enrollment.findFirstOrThrow({ where: { classId: W.f2East, termId: A.termId } })).studentId, status: 'ABSENT' }], changedAt: `${tuesday}T08:10:00+02:00`, deviceId: 'phone-1' }] },
    });
    expect(r.status).toBe(200);
    // Mr Chikore is not the class teacher of Form 2 East, so this one is refused; the same register from its own teacher works.
    expect(r.json.data.results[0]).toMatchObject({ ref: 'offline-1', ok: false, status: 404 });
    const moyo = await sessionFor(prisma, W.teachers.moyo);
    const east = await prisma.enrollment.findMany({ where: { classId: W.f2East, termId: A.termId } });
    const ok = await call('academics/attendance/sync', 'POST', {
      as: moyo,
      body: { registers: [{ ref: 'offline-2', classId: W.f2East, date: tuesday, session: 'AM', entries: [{ studentId: east[0]!.studentId, status: 'ABSENT' }], changedAt: `${tuesday}T08:10:00+02:00`, deviceId: 'phone-2' }] },
    });
    expect(ok.json.data.results[0]).toMatchObject({ ref: 'offline-2', ok: true, outcome: 'created' }); // no reason asked for
    const row = await prisma.attendanceRegister.findFirstOrThrow({ where: { classId: W.f2East, date: new Date(tuesday) } });
    expect(row.markedAt.toISOString()).toBe(`${tuesday}T06:10:00.000Z`); // when she marked it, not when it arrived
    expect(row.deviceId).toBe('phone-2');
  });

  it('cannot change a closed term', async () => {
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { status: 'CLOSED' } });
    const r = await reg(A.operator!, mark([{ studentId: kids[1], status: 'ABSENT' }], { changedAt: at(600_000) }));
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/closed/);
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { status: 'OPEN' } });
  });
});

describe('students who are suspended', () => {
  it('are filled in as Suspended and cannot be changed', async () => {
    const incident = await prisma.disciplineIncident.create({ data: { schoolId: A.schoolId, occurredAt: NOW, location: 'CLASSROOM', category: 'FIGHTING', severity: 'SERIOUS', description: 'Fight', recordedById: A.users.HEAD.id } });
    await prisma.disciplineAction.create({
      data: { schoolId: A.schoolId, incidentId: incident.id, studentId: kids[5]!, type: 'SUSPENSION', status: 'APPROVED', startDate: new Date(day(-1)), endDate: new Date(day(1)), requestedById: A.users.HEAD.id, approvedById: A.users.HEAD.id, decidedAt: NOW },
    });
    const s = (await reg(classTeacher, null, 'GET', `?classId=${W.f1North}`)).json.data;
    expect(s.students.find((x: { id: string }) => x.id === kids[5])).toMatchObject({ status: 'SUSPENDED', locked: true });
    // The phone says Present; the register keeps Suspended.
    const r = await reg(classTeacher, mark([{ studentId: kids[5], status: 'PRESENT' }], { changedAt: at(700_000) }));
    expect(r.json.data.locked).toBe(1);
    expect(await statusOf(TODAY, kids[5]!)).toBe('SUSPENDED');
    // Nobody can be marked Suspended by hand.
    const hand = await reg(classTeacher, mark([{ studentId: kids[1], status: 'SUSPENDED' }], { changedAt: at(800_000) }));
    expect(hand.status).toBe(422);
    expect(hand.json.message).toMatch(/is not suspended or on exeat/);
  });
});

describe('two devices and the latest change wins', () => {
  const body = (status: 'ABSENT' | 'PRESENT', ms: number, device: string) =>
    ({ classId: W.f2East, date: day(-1), session: 'AM', entries: [{ studentId: '', status }], changedAt: at(ms), deviceId: device });
  let east: string;
  let moyo: Awaited<ReturnType<typeof sessionFor>>;

  it('keeps the later version and records both when an older one arrives afterwards', async () => {
    moyo = await sessionFor(prisma, W.teachers.moyo);
    east = (await prisma.enrollment.findFirstOrThrow({ where: { classId: W.f2East, termId: A.termId }, orderBy: { id: 'asc' } })).studentId;
    const mk = (status: 'ABSENT' | 'PRESENT', ms: number, device: string) => ({ ...body(status, ms, device), entries: [{ studentId: east, status }], correctionReason: 'Sync from phones' });
    // Phone 2 saved at +10 min (PRESENT); phone 1, which was offline, arrives later with an older version (ABSENT, +5 min).
    expect((await call('academics/attendance/register', 'PUT', { as: moyo, body: mk('PRESENT', 600_000, 'phone-2') })).json.data.outcome).toBe('updated');
    const late = await call('academics/attendance/register', 'PUT', { as: moyo, body: mk('ABSENT', 300_000, 'phone-1') });
    expect(late.json.data.outcome).toBe('kept_newer');
    const row = await prisma.attendanceRegister.findFirstOrThrow({ where: { classId: W.f2East, date: new Date(day(-1)) }, include: { entries: true } });
    expect(row.entries.find((e) => e.studentId === east)!.status).toBe('PRESENT');
    const conflict = (await audit('REGISTER_CONFLICT')).at(-1)!;
    expect(conflict.detail).toMatch(/older version .* was not applied/);
    expect(JSON.stringify(conflict.before)).toMatch(/phone-2/);
    expect(JSON.stringify(conflict.after)).toMatch(/phone-1/);
    expect(JSON.stringify(conflict.after)).toMatch(/ABSENT/);
  });

  it('applies a newer version from another device and keeps the one it replaced in the log', async () => {
    const mk = (status: 'ABSENT' | 'PRESENT', ms: number, device: string) => ({ ...body(status, ms, device), entries: [{ studentId: east, status }], correctionReason: 'Sync from phones' });
    const r = await call('academics/attendance/register', 'PUT', { as: moyo, body: mk('ABSENT', 900_000, 'phone-1') });
    expect(r.json.data.outcome).toBe('updated');
    expect(await prisma.attendanceEntry.findFirstOrThrow({ where: { studentId: east, register: { classId: W.f2East, date: new Date(day(-1)) } } })).toMatchObject({ status: 'ABSENT' });
    const conflict = (await audit('REGISTER_CONFLICT')).at(-1)!;
    expect(conflict.detail).toMatch(/changed on two devices/);
    expect(JSON.stringify(conflict.before)).toMatch(/phone-2/); // the version it replaced: present (only exceptions are listed), from phone 2
    expect(JSON.stringify(conflict.before)).toContain('"marks":[]');
    expect(JSON.stringify(conflict.after)).toMatch(/phone-1/);
    expect(JSON.stringify(conflict.after)).toMatch(/ABSENT/);
  });

  it('syncs a batch, saving what it can and saying what it could not', async () => {
    const r = await call('academics/attendance/sync', 'POST', {
      as: classTeacher,
      body: {
        registers: [
          { ref: 'a', classId: W.f1North, date: day(-2), session: 'AM', entries: [{ studentId: kids[1], status: 'ABSENT' }], changedAt: `${day(-2)}T07:50:00+02:00`, deviceId: 'phone-1' },
          { ref: 'b', classId: W.f1North, date: day(5), session: 'AM', entries: [{ studentId: kids[1], status: 'ABSENT' }], deviceId: 'phone-1' },
          { ref: 'c', classId: W.f1North, date: day(-2), session: 'AM', entries: [{ studentId: kids[1], status: 'ABSENT' }], changedAt: `${day(-2)}T07:50:00+02:00`, deviceId: 'phone-1' },
        ],
      },
    });
    expect(r.status).toBe(200);
    const res = r.json.data.results;
    expect(res[0]).toMatchObject({ ref: 'a', ok: true, outcome: 'created' });
    expect(res[1]).toMatchObject({ ref: 'b', ok: false });
    expect(res[2]).toMatchObject({ ref: 'c', ok: true, outcome: 'unchanged' }); // the same register sent twice
    expect(await prisma.attendanceRegister.count({ where: { classId: W.f1North, date: new Date(day(-2)) } })).toBe(1);
  });
});

describe('alerts', () => {
  const outbox = (studentId: string) => prisma.messageOutbox.findMany({ where: { schoolId: A.schoolId, studentId, dedupeKey: { contains: `:${TODAY}:AM` } } });

  it('queue an SMS to the primary guardian for an absence without a reason, and none for a reason', async () => {
    await reg(A.operator!, mark([
      { studentId: kids[4], status: 'ABSENT' },
      { studentId: kids[3], status: 'EXCUSED', reason: 'SICK' },
      { studentId: kids[2], status: 'ABSENT', reason: 'FAMILY' },
    ], { changedAt: at(2_000_000) }));
    const sms = (await outbox(kids[4]!))[0]!;
    expect(sms.body).toMatch(/^School A: .+ \(Form 1 North\) was marked absent today, 14 Oct\. Please contact the school\.$/);
    expect(sms).toMatchObject({ status: 'QUEUED', channel: 'SMS' });
    const guardian = await prisma.studentGuardian.findFirstOrThrow({ where: { studentId: kids[4]!, isPrimary: true }, include: { guardian: true } });
    expect(sms.toPhone).toBe(guardian.guardian.phone);
    expect(await outbox(kids[3]!)).toHaveLength(0); // excused
    expect(await outbox(kids[2]!)).toHaveLength(0); // absent, but the family gave a reason
    expect((await audit('QUEUE_SMS')).length).toBeGreaterThan(0);
  });

  it('are not duplicated when the register is saved again, and are withdrawn if the student turns out to be present', async () => {
    await reg(A.operator!, mark([{ studentId: kids[4], status: 'ABSENT' }, { studentId: kids[1], status: 'LATE', arrivalTime: '09:00' }], { changedAt: at(2_100_000) }));
    expect(await outbox(kids[4]!)).toHaveLength(1);
    await reg(A.operator!, mark([{ studentId: kids[4], status: 'PRESENT' }], { changedAt: at(2_200_000) }));
    expect(await outbox(kids[4]!)).toHaveLength(0);
  });

  it('can be switched off, and need the Communication module', async () => {
    await prisma.academicsSettings.update({ where: { schoolId: A.schoolId }, data: { absentSmsAlert: false } });
    await reg(A.operator!, mark([{ studentId: kids[2], status: 'ABSENT' }], { changedAt: at(2_300_000) }));
    expect(await outbox(kids[2]!)).toHaveLength(0);
    await prisma.academicsSettings.update({ where: { schoolId: A.schoolId }, data: { absentSmsAlert: true } });
    await prisma.schoolModule.create({ data: { schoolId: A.schoolId, module: 'communication', enabled: false } });
    await reg(A.operator!, mark([{ studentId: kids[2], status: 'ABSENT' }], { changedAt: at(2_400_000) }));
    expect(await outbox(kids[2]!)).toHaveLength(0);
    await prisma.schoolModule.deleteMany({ where: { schoolId: A.schoolId, module: 'communication' } });
    await reg(A.operator!, mark([{ studentId: kids[2], status: 'ABSENT' }, { studentId: kids[0], status: 'LATE', arrivalTime: '08:30' }], { changedAt: at(2_500_000) }));
    expect(await outbox(kids[2]!)).toHaveLength(1); // on again
  });

  it('tell the class teacher and the Deputy when a student is absent three days in a row', async () => {
    // Monday and Tuesday were marked above with this student absent; today's register makes the third.
    expect(await statusOf(day(-2), kids[1]!)).toBe('ABSENT');
    expect(await statusOf(day(-1), kids[1]!)).toBe('ABSENT');
    await reg(A.operator!, mark([{ studentId: kids[1], status: 'ABSENT', reason: 'OTHER' }], { changedAt: at(2_600_000) }));
    const notes = await prisma.notification.findMany({ where: { schoolId: A.schoolId, type: 'CHRONIC_ABSENCE', title: { contains: 'in a row' } } });
    const to = new Set(notes.map((n) => n.userId));
    expect(to.has(W.teachers.chikore)).toBe(true);
    expect(to.has(deputy)).toBe(true);
    expect(notes[0]!.title).toMatch(/has been absent [0-9]+ days in a row/);
  });

  it('can be switched off', async () => {
    await prisma.academicsSettings.update({ where: { schoolId: A.schoolId }, data: { chronicAbsenceAlert: false } });
    const before = await prisma.notification.count({ where: { schoolId: A.schoolId, type: 'CHRONIC_ABSENCE' } });
    await reg(A.operator!, mark([{ studentId: kids[1], status: 'ABSENT', reason: 'OTHER' }, { studentId: kids[2], status: 'ABSENT', reason: 'OTHER' }], { changedAt: at(2_700_000) }));
    expect(await prisma.notification.count({ where: { schoolId: A.schoolId, type: 'CHRONIC_ABSENCE' } })).toBe(before);
    await prisma.academicsSettings.update({ where: { schoolId: A.schoolId }, data: { chronicAbsenceAlert: true } });
  });

  it('also tell them when a student drops below 90% attendance for the term', async () => {
    // Five registers are enough to judge; this student is absent in most of them.
    await prisma.academicsSettings.update({ where: { schoolId: A.schoolId }, data: { attendanceThresholdPct: 90 } });
    const before = await prisma.notification.count({ where: { schoolId: A.schoolId, type: 'CHRONIC_ABSENCE', title: { contains: 'below 90%' } } });
    for (const d of ['2026-10-06', '2026-10-07', '2026-10-08']) {
      await call('academics/attendance/register', 'PUT', { as: A.operator!, body: mark([{ studentId: kids[0], status: 'ABSENT', reason: 'OTHER' }], { date: d, correctionReason: 'Back-fill for the test', changedAt: at(2_800_000) }) });
    }
    await reg(A.operator!, mark([{ studentId: kids[0], status: 'ABSENT', reason: 'OTHER' }], { changedAt: at(2_900_000) }));
    const notes = await prisma.notification.findMany({ where: { schoolId: A.schoolId, type: 'CHRONIC_ABSENCE', title: { contains: 'below 90%' } } });
    expect(notes.length).toBeGreaterThan(before);
    expect(new Set(notes.map((n) => n.userId)).has(deputy)).toBe(true);
  });
});

describe("the class teacher's dashboard and the Head's daily summary", () => {
  it('says "Mark today\'s register" until the register is done', async () => {
    const moyo = await sessionFor(prisma, W.teachers.moyo);
    const due = await call('academics/attendance/due', 'GET', { as: moyo });
    expect(due.json.data.due).toEqual([{ classId: W.f2East, className: 'Form 2 East' }]);
    expect((await call('academics/attendance/due', 'GET', { as: classTeacher })).json.data.due).toEqual([]); // Mr Chikore has marked today's
  });

  it('shows registers marked and not marked by class, present % by form and the absentees', async () => {
    const r = await call('academics/attendance/summary', 'GET', { as: A.operator! });
    expect(r.status).toBe(200);
    const d = r.json.data;
    expect(d).toMatchObject({ schoolDay: true, marked: 1 });
    expect(d.classes.find((c: { name: string }) => c.name === 'Form 1 North')).toMatchObject({ marked: true, markedBy: expect.any(String) });
    expect(d.classes.find((c: { name: string }) => c.name === 'Form 2 East')).toMatchObject({ marked: false, teacher: 'Mrs Rudo Moyo' });
    expect(d.forms.find((f: { form: string }) => f.form === 'Form 1')).toMatchObject({ rate: expect.any(Number) });
    expect(d.absentees.length).toBeGreaterThan(0);
    expect(d.absentees[0]).toMatchObject({ className: 'Form 1 North', guardianPhone: expect.stringMatching(/^\+/) });
    expect((await call('academics/attendance/summary', 'GET', { as: classTeacher })).status).toBe(200); // class teachers hold .view for their own classes
    expect((await call('academics/attendance/summary', 'GET', { as: await sessionFor(prisma, W.teachers.dube) })).status).toBe(403);
  });

  it('has no summary on a day without school', async () => {
    const r = await call('academics/attendance/summary', 'GET', { as: A.operator!, query: '?date=2026-10-17' });
    expect(r.json.data).toMatchObject({ schoolDay: false, classes: [] });
    expect(r.json.data.reason).toMatch(/weekend/);
  });

  it('reminds the class teachers of classes that have not marked, once in a while', async () => {
    const dep = await sessionFor(prisma, deputy);
    const r = await call('academics/attendance/remind', 'POST', { as: dep, body: { classIds: [W.f1North, W.f2East] } });
    expect(r.status).toBe(200);
    expect(r.json.data.reminded).toBe(1); // only Form 2 East has not marked
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: W.teachers.moyo, type: 'REGISTER_REMINDER' } });
    expect(note.title).toMatch(/mark today's register for Form 2 East/);
    expect((await call('academics/attendance/remind', 'POST', { as: dep, body: { classIds: [W.f2East] } })).json.data.reminded).toBe(0); // not again within the same few hours
    expect((await call('academics/attendance/remind', 'POST', { as: classTeacher, body: { classIds: [W.f2East] } })).status).toBe(403);
    expect((await audit('REMIND_REGISTER')).length).toBeGreaterThan(0);
  });

  it('gives the class a term summary with each student\'s rate', async () => {
    const r = await call('academics/classes/[id]/attendance', 'GET', { as: A.operator!, params: { id: W.f1North } });
    expect(r.status).toBe(200);
    expect(r.json.data.registersMarked).toBeGreaterThan(1);
    const kid = r.json.data.students.find((s: { id: string }) => s.id === kids[1]);
    expect(kid.absent).toBeGreaterThan(0);
    expect(kid.rate).toBeLessThan(100);
  });
});

describe('another school', () => {
  it('cannot read or mark this school\'s register', async () => {
    const b = await sessionFor(prisma, B.users.TEACHER.id);
    expect((await call('academics/attendance/register', 'PUT', { as: B.operator!, body: mark([{ studentId: kids[1], status: 'ABSENT' }], { changedAt: at(5_000_000) }) })).status).toBe(404);
    expect((await call('academics/attendance/view', 'GET', { as: B.operator!, query: `?classId=${W.f1North}` })).status).toBe(404);
    expect((await call('academics/attendance/summary', 'GET', { as: B.operator! })).json.data.classes.map((c: { id: string }) => c.id)).not.toContain(W.f1North);
    expect(b.schoolId).toBe(B.schoolId);
  });
});

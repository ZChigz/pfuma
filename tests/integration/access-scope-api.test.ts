// @vitest-environment node
// Scopes, through the API. The engine tests prove how each scope is worked out; this file proves the routes use them: what a list returns
// and what a single record answers, for a person whose grant reaches only part of the school. A person can be refused the record (404:
// the same answer as a record that does not exist) or never see it listed, and widening the grant (a role for the whole school, or
// the Owner) is the only way to reach the rest.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, userWithRoles, type SeededSchool, type SeededUser } from '../helpers/seed';
import { assign, buildWorld, students, type World } from '../helpers/academics';
import { financeWorld, type FinanceWorld } from '../helpers/finance';
import { call } from '../helpers/route';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let W: World;
let F: FinanceWorld;
let prisma: typeof import('@/lib/prisma').prisma;
let payments: typeof import('@/lib/finance/payments');
let leave: typeof import('@/lib/hr/leave');

const stu: Record<string, string[]> = {};
let chikore: SeededUser;      // TEACHER: teaches Maths to Form 1 North
let ncube: SeededUser;        // CLASS_TEACHER of Form 2 East
let hod: SeededUser;          // HOD of Sciences
let bm: SeededUser;           // BOARDING_MASTER of Chimanimani
let other: SeededUser;        // a student in school B

/** Which of these learners a list shows (the response text carries each learner's id). */
async function listed(as: SeededUser, ids: string[], file = 'students', query = '?pageSize=100'): Promise<string[]> {
  const r = await call(file, 'GET', { as, query });
  expect(r.status, `${as.fullName} ${file}`).toBe(200);
  return ids.filter((id) => r.text.includes(id)).sort();
}
const all = () => Object.values(stu).flat().sort();
const ids = (...keys: string[]) => keys.flatMap((k) => stu[k]!).sort();

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  [payments, leave] = await Promise.all([import('@/lib/finance/payments'), import('@/lib/hr/leave')]);
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  W = await buildWorld(prisma, A);
  F = await financeWorld(prisma, A);

  stu.f1North = await students(prisma, A, W.f1North, 2, 'North');
  stu.f1South = await students(prisma, A, W.f1South, 2, 'South');
  stu.f2East = await students(prisma, A, W.f2East, 2, 'East');
  stu.f3North = await students(prisma, A, W.f3North, 2, 'Third');
  stu.b = await students(prisma, B, B.classId, 1, 'Other');
  other = B.users.ADMIN;

  // Mr Chikore teaches Maths to Form 1 North.
  await assign(prisma, A, { teacherId: W.teachers.chikore, subjectId: W.subjects.maths, classId: W.f1North });
  chikore = { ...A.users.TEACHER, id: W.teachers.chikore, ...(await prisma.user.findUniqueOrThrow({ where: { id: W.teachers.chikore }, select: { email: true, fullName: true } })) } as SeededUser;
  // Mrs Ncube is class teacher of Form 2 East.
  const nc = await prisma.user.findUniqueOrThrow({ where: { id: W.teachers.ncube } });
  await prisma.userRole.create({ data: { schoolId: A.schoolId, userId: nc.id, roleId: (await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key: 'CLASS_TEACHER' } })).id } });
  await prisma.classTeacher.create({ data: { schoolId: A.schoolId, classId: W.f2East, termId: A.termId, userId: nc.id } });
  ncube = { ...A.users.TEACHER, id: nc.id, email: nc.email, fullName: nc.fullName };
  // A head of Sciences: the two Form 1 South pupils take Maths, a Sciences subject.
  hod = await userWithRoles(prisma, A, ['HOD'], 'hod');
  await prisma.department.update({ where: { id: W.dept.sciences }, data: { hodUserId: hod.id } });
  for (const s of stu.f1South!) await prisma.studentSubject.create({ data: { schoolId: A.schoolId, studentId: s, subjectId: W.subjects.maths, termId: A.termId } });
  // A boarding master with one hostel and one boarder (a Form 3 pupil) in it.
  bm = await userWithRoles(prisma, A, ['BOARDING_MASTER'], 'bm');
  const hostel = await prisma.facHostel.create({ data: { schoolId: A.schoolId, name: 'Chimanimani', gender: 'M', boardingMasterId: bm.id, capacity: 10 } });
  const room = await prisma.facRoom.create({ data: { schoolId: A.schoolId, hostelId: hostel.id, name: 'Room 1', capacity: 4 } });
  const bed = await prisma.facBed.create({ data: { schoolId: A.schoolId, roomId: room.id, number: '1' } });
  await prisma.student.update({ where: { id: stu.f3North![0]! }, data: { boarding: 'BOARDER' } });
  await prisma.facBedAllocation.create({ data: { schoolId: A.schoolId, studentId: stu.f3North![0]!, bedId: bed.id, termId: A.termId, fromDate: new Date('2026-01-10'), allocatedById: bm.id } });
}, 300_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('learners, by scope', () => {
  it('a teacher (ASSIGNED) is listed only the classes they teach', async () => {
    expect(await listed(chikore, all())).toEqual(ids('f1North'));
  });

  it('a class teacher (CLASS) is listed only their class', async () => {
    expect(await listed(ncube, all())).toEqual(ids('f2East'));
  });

  it('a head of department (DEPARTMENT) is listed the learners who take the department\'s subjects', async () => {
    expect(await listed(hod, all())).toEqual(ids('f1South'));
  });

  it('a boarding master (HOSTEL) is listed the boarders asleep in their hostel', async () => {
    expect(await listed(bm, all())).toEqual([stu.f3North![0]!]);
  });

  it('a role for the whole school, and the Owner, are listed every learner of the school and never another school\'s', async () => {
    const mine = [...ids('f1North', 'f1South', 'f2East', 'f3North')];
    for (const as of [A.users.HEAD, A.users.ADMIN, A.users.DIRECTOR]) {
      const got = await listed(as, all());
      expect(got.filter((id) => mine.includes(id)).length, as.fullName).toBeGreaterThanOrEqual(mine.length - 0);
      expect(got.includes(stu.b![0]!), `${as.fullName} sees another school`).toBe(false);
    }
  });

  it('the single learner answers the same way: inside the scope 200, outside it 404, and another school\'s 404 even for the Owner', async () => {
    const open = (as: SeededUser, id: string) => call('students/[id]', 'GET', { as, params: { id } }).then((r) => r.status);
    expect(await open(chikore, stu.f1North![0]!)).toBe(200);
    expect(await open(chikore, stu.f1South![0]!)).toBe(404);
    expect(await open(chikore, stu.f2East![0]!)).toBe(404);
    expect(await open(ncube, stu.f2East![0]!)).toBe(200);
    expect(await open(ncube, stu.f1North![0]!)).toBe(404);
    expect(await open(hod, stu.f1South![0]!)).toBe(200);
    expect(await open(hod, stu.f2East![0]!)).toBe(404);
    expect(await open(bm, stu.f3North![0]!)).toBe(200);
    expect(await open(bm, stu.f3North![1]!)).toBe(404);
    for (const as of [A.users.DIRECTOR, A.users.ADMIN, A.users.HEAD]) expect(await open(as, stu.b![0]!), as.fullName).toBe(404);
    expect(await open(other, stu.f1North![0]!)).toBe(404);
  });

  /** An exception that gives `key` to the class teacher for her own class only. */
  const giveForClass = (key: string) =>
    prisma.userPermissionOverride.create({
      data: { schoolId: A.schoolId, userId: ncube.id, permissionKey: key, effect: 'GRANT', scope: 'CLASS', scopeId: W.f2East, reason: 'Scope test', expiresAt: new Date(Date.now() + 86_400_000), createdById: A.users.DIRECTOR.id },
    });

  it('the sections of a profile follow the same scope: a permission given for one class opens that class and no other', async () => {
    await giveForClass('students.guardians.view');
    await giveForClass('students.medical.view');
    for (const file of ['students/[id]/guardians', 'students/[id]/medical']) {
      expect((await call(file, 'GET', { as: ncube, params: { id: stu.f2East![0]! } })).status, `${file} in her class`).toBe(200);
      expect((await call(file, 'GET', { as: ncube, params: { id: stu.f1North![0]! } })).status, `${file} outside it`).toBe(404);
    }
    // Without the permission at all the answer is "forbidden", whatever the scope.
    expect((await call('students/[id]/discipline', 'GET', { as: chikore, params: { id: stu.f1North![0]! } })).status).toBe(403);
  });

  it('a search or an export cannot be used to get round the scope', async () => {
    const r = await call('students/search', 'GET', { as: chikore, query: '?q=East' });
    expect(r.status).toBe(200);
    for (const id of stu.f2East!) expect(r.text.includes(id)).toBe(false);
    await giveForClass('students.profiles.export');
    const csv = await call('students/export', 'POST', { as: ncube, body: {} });
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('East');
    for (const name of ['North', 'South', 'Third']) expect(csv.text.includes(name), `the export holds ${name} learners`).toBe(false);
    // Naming learners from other classes in the selection changes nothing.
    const picked = await call('students/export', 'POST', { as: ncube, body: { ids: [...stu.f1North!, stu.f2East![0]!] } });
    expect(picked.text).not.toContain('North');
  });
});

describe('money recorded by the person (RECORDED_BY_ME)', () => {
  it('a clerk is listed only the payments they recorded; the Bursar is listed every payment', async () => {
    const general = (await (await import('@/lib/finance/setup')).listFunds(F.bursar)).find((f) => f.code === 'GENERAL')!.id;
    const mine = await payments.recordPayment(F.clerk, { studentId: F.students.day1, currency: 'USD', method: 'CASH', lines: [{ fundId: general, amount: '11.00' }] });
    const theirs = await payments.recordPayment(F.bursar, { studentId: F.students.day2, currency: 'USD', method: 'CASH', lines: [{ fundId: general, amount: '12.00' }] });
    const clerkSession = { ...A.users.TEACHER, id: F.clerk.id, email: F.clerk.email, fullName: F.clerk.fullName } as SeededUser;
    const bursarSession = { ...A.users.TEACHER, id: F.bursar.id, email: F.bursar.email, fullName: F.bursar.fullName } as SeededUser;

    const clerkList = await call('finance/payments', 'GET', { as: clerkSession });
    expect(clerkList.status).toBe(200);
    expect(clerkList.text).toContain(mine.payments[0]!.id);
    expect(clerkList.text).not.toContain(theirs.payments[0]!.id);

    const bursarList = await call('finance/payments', 'GET', { as: bursarSession });
    expect(bursarList.text).toContain(mine.payments[0]!.id);
    expect(bursarList.text).toContain(theirs.payments[0]!.id);

    // The receipt of a payment somebody else recorded is "not found" for the clerk, found for the Bursar.
    await expect(payments.getReceipt(F.clerk, theirs.payments[0]!.id)).rejects.toMatchObject({ status: 404 });
    expect((await payments.getReceipt(F.clerk, mine.payments[0]!.id)).id).toBe(mine.payments[0]!.id);
    expect((await payments.getReceipt(F.bursar, theirs.payments[0]!.id)).id).toBe(theirs.payments[0]!.id);
  });
});

describe('records of one\'s own (SELF)', () => {
  it('a teacher is listed their own leave requests, and the Head everyone\'s', async () => {
    const { hrWorld } = await import('../helpers/hr');
    const H = await hrWorld(prisma, A);
    await (await import('@/lib/payroll/settings-service')).getPayrollSettings(H.hr);
    const emp = await import('@/lib/hr/employees');
    const vacation = (await prisma.leaveType.findFirstOrThrow({ where: { schoolId: A.schoolId, code: 'VACATION' } })).id;
    const mk = async (a: { id: string }) => {
      const e = await emp.createEmployee(H.hr, { firstName: `Leave${a.id.slice(-4)}`, surname: 'Staff', jobTitle: 'Teacher', category: 'TEACHING', employer: 'SCHOOL', startDate: '2026-01-05' });
      await prisma.employee.update({ where: { id: e.id }, data: { userId: a.id } });
      return (await prisma.leaveRequest.create({ data: { schoolId: A.schoolId, employeeId: e.id, leaveTypeId: vacation, startDate: new Date('2032-04-05'), endDate: new Date('2032-04-05'), days: 1, requestedById: a.id } })).id;
    };
    const mine = await mk(H.teacher);
    const theirs = await mk(H.teacher2);
    const session = (a: { id: string; email: string; fullName: string }) => ({ ...A.users.TEACHER, id: a.id, email: a.email, fullName: a.fullName }) as SeededUser;

    const own = await call('hr/leave/requests', 'GET', { as: session(H.teacher) });
    expect(own.status).toBe(200);
    expect(own.text).toContain(mine);
    expect(own.text).not.toContain(theirs);
    const head = await call('hr/leave/requests', 'GET', { as: session(H.head) });
    expect(head.text).toContain(mine);
    expect(head.text).toContain(theirs);
    void leave;
  });
});

// @vitest-environment node
// The access engine against a real database: scopes worked out from records, scopeWhere for lists, record checks with their reasons,
// exceptions, the previous-term window, the module cache, and the audit of refused attempts.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, userWithRoles, type SeededSchool } from '../helpers/seed';
import { assign, buildWorld, students, type World } from '../helpers/academics';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let W: World;
let prisma: typeof import('@/lib/prisma').prisma;
let engine: typeof import('@/lib/access/index');
let access: typeof import('@/lib/access');

type Ctx = Awaited<ReturnType<typeof import('@/lib/access').loadAccessContext>>;
const ctxOf = async (u: { id: string; schoolId: string; email: string; fullName: string; role: string }): Promise<Ctx> =>
  access.loadAccessContext({ user: { id: u.id, schoolId: u.schoolId, role: u.role as never, email: u.email, fullName: u.fullName } });

const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id).sort();
const stu: Record<string, string[]> = {};
let teacher: Ctx, classTeacher: Ctx, hod: Ctx, boardingMaster: Ctx, owner: Ctx, nobody: Ctx, clerk: Ctx, employeeUser: Ctx;
let boarderId: string, hostelId: string, deptEmployee: string;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  engine = await import('@/lib/access/index');
  access = await import('@/lib/access');
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  W = await buildWorld(prisma, A);

  // The seeded school already has one student in Form 1 North.
  stu.f1North = [A.studentId, ...(await students(prisma, A, W.f1North, 2, 'North'))];
  stu.f1South = await students(prisma, A, W.f1South, 2, 'South');
  stu.f2East = await students(prisma, A, W.f2East, 2, 'East');
  stu.b = await students(prisma, B, B.classId, 1, 'Other');

  // Mr Chikore teaches Maths to Form 1 North.
  await assign(prisma, A, { teacherId: W.teachers.chikore, subjectId: W.subjects.maths, classId: W.f1North });
  // Mrs Ncube is class teacher of Form 2 East.
  const ncube = await prisma.user.findUniqueOrThrow({ where: { id: W.teachers.ncube } });
  const cl = await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key: 'CLASS_TEACHER' } });
  await prisma.userRole.create({ data: { schoolId: A.schoolId, userId: ncube.id, roleId: cl.id } });
  await prisma.classTeacher.create({ data: { schoolId: A.schoolId, classId: W.f2East, termId: A.termId, userId: ncube.id } });

  // A head of Sciences; two Form 1 South pupils take Maths (a Sciences subject), nobody else does.
  const hodUser = await userWithRoles(prisma, A, ['HOD'], 'hod');
  await prisma.department.update({ where: { id: W.dept.sciences }, data: { hodUserId: hodUser.id } });
  for (const s of stu.f1South) await prisma.studentSubject.create({ data: { schoolId: A.schoolId, studentId: s, subjectId: W.subjects.maths, termId: A.termId } });
  const e = await prisma.employee.create({ data: { schoolId: A.schoolId, employeeNo: 'E-HOD', firstName: 'Head', surname: 'Sciences', jobTitle: 'Teacher', departmentId: W.dept.sciences, startDate: new Date('2020-01-01'), createdById: hodUser.id } });
  deptEmployee = e.id;

  // A boarding master with one hostel and one boarder in it.
  const bm = await userWithRoles(prisma, A, ['BOARDING_MASTER'], 'bm');
  const hostel = await prisma.facHostel.create({ data: { schoolId: A.schoolId, name: 'Chimanimani', gender: 'M', boardingMasterId: bm.id, capacity: 10 } });
  hostelId = hostel.id;
  const room = await prisma.facRoom.create({ data: { schoolId: A.schoolId, hostelId, name: 'Room 1', capacity: 4 } });
  const bed = await prisma.facBed.create({ data: { schoolId: A.schoolId, roomId: room.id, number: '1' } });
  boarderId = stu.f2East[0]!;
  await prisma.facBedAllocation.create({ data: { schoolId: A.schoolId, studentId: boarderId, bedId: bed.id, termId: A.termId, fromDate: new Date('2026-01-10'), allocatedById: bm.id } });

  // A clerk who is also an employee.
  const clerkUser = await userWithRoles(prisma, A, ['ACCOUNTS_CLERK'], 'clerk');
  await prisma.employee.create({ data: { schoolId: A.schoolId, employeeNo: 'E-CLERK', userId: clerkUser.id, firstName: 'Clerk', surname: 'Chipo', jobTitle: 'Clerk', startDate: new Date('2021-01-01'), createdById: hodUser.id } });

  teacher = await ctxOf({ ...A.users.TEACHER, id: W.teachers.chikore, email: 'c@x', fullName: 'Chikore', role: 'TEACHER' });
  classTeacher = await ctxOf({ id: ncube.id, schoolId: A.schoolId, email: ncube.email, fullName: ncube.fullName, role: 'TEACHER' });
  hod = await ctxOf(hodUser);
  boardingMaster = await ctxOf(bm);
  clerk = await ctxOf(clerkUser);
  owner = await ctxOf(A.users.DIRECTOR);
  nobody = await ctxOf(await userWithRoles(prisma, A, [], 'nobody'));
  employeeUser = clerk;
}, 300_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('who holds what (read from the database)', () => {
  it('builds each person\'s keys with their scopes from the role grants', () => {
    expect(engine.grantsFor(engine.effectiveOf(teacher), 'exams.marks.enter')).toEqual([{ scope: 'ASSIGNED' }]);
    expect(engine.grantsFor(engine.effectiveOf(classTeacher), 'finance.arrears.flag')).toEqual([{ scope: 'CLASS' }]);
    expect(engine.grantsFor(engine.effectiveOf(hod), 'exams.marks.verify')).toEqual([{ scope: 'DEPARTMENT' }]);
    expect(engine.grantsFor(engine.effectiveOf(clerk), 'finance.payments.record')).toEqual([{ scope: 'RECORDED_BY_ME' }]);
    expect(engine.grantsFor(engine.effectiveOf(owner), 'finance.payments.void')).toEqual([{ scope: 'SCHOOL' }]);
    expect(engine.grantsFor(engine.effectiveOf(nobody), 'exams.marks.enter')).toEqual([]);
    expect(teacher.permVersion).toBe(0);
  });
});

describe('scope resolvers', () => {
  it('ASSIGNED: the classes, subjects and lessons the person teaches this term', async () => {
    const r = await engine.reach(teacher, 'ASSIGNED');
    expect(r.directClassIds).toEqual([W.f1North]);
    expect(r.subjectIds).toEqual([W.subjects.maths]);
    expect(r.assignmentIds).toHaveLength(1);
  });
  it('CLASS: the classes the person is class teacher of this term', async () => {
    expect((await engine.reach(classTeacher, 'CLASS')).classIds).toEqual([W.f2East]);
    expect((await engine.reach(teacher, 'CLASS')).classIds).toEqual([]);
  });
  it('DEPARTMENT: the department the person heads, its subjects and its staff', async () => {
    const r = await engine.reach(hod, 'DEPARTMENT');
    expect(r.departmentIds).toEqual([W.dept.sciences]);
    expect(r.subjectIds.sort()).toEqual([W.subjects.maths, W.subjects.science, W.subjects.physics].sort());
    expect(r.employeeIds).toEqual([deptEmployee]);
  });
  it('HOSTEL: the hostel the person runs and the boarders asleep in it now', async () => {
    const r = await engine.reach(boardingMaster, 'HOSTEL');
    expect(r.hostelIds).toEqual([hostelId]);
    expect(r.studentIds).toEqual([boarderId]);
  });
  it('STORE, SELF and RECORDED_BY_ME', async () => {
    const keeper = await userWithRoles(prisma, A, [], 'keeper');
    expect((await engine.reach(await ctxOf(keeper), 'STORE')).storeIds).toEqual([]);
    const store = await prisma.facStore.create({ data: { schoolId: A.schoolId, name: 'Main store', storekeeperId: keeper.id } });
    expect((await engine.reach(await ctxOf(keeper), 'STORE')).storeIds).toEqual([store.id]);
    expect((await engine.reach(clerk, 'SELF')).employeeId).not.toBeNull();
    expect((await engine.reach(nobody, 'SELF')).employeeId).toBeNull();
    expect(await engine.reach(clerk, 'RECORDED_BY_ME')).toEqual({ userId: clerk.id });
    expect(await engine.reach(clerk, 'CHILDREN')).toEqual({ none: true });
  });
  it('follow the records: when the timetable changes, the reach changes with it', async () => {
    const mine = () => ctxOf({ id: W.teachers.chikore, schoolId: A.schoolId, email: 'c@x', fullName: 'Chikore', role: 'TEACHER' });
    const fresh = await mine();
    expect((await engine.reach(fresh, 'ASSIGNED')).directClassIds).toEqual([W.f1North]);
    const extra = await assign(prisma, A, { teacherId: W.teachers.chikore, subjectId: W.subjects.english, classId: W.f1South });
    try {
      expect((await engine.reach(fresh, 'ASSIGNED')).directClassIds).toEqual([W.f1North]); // cached for the life of the request
      expect((await engine.reach(await mine(), 'ASSIGNED')).directClassIds.sort()).toEqual([W.f1North, W.f1South].sort());
    } finally {
      await prisma.teacherAssignment.delete({ where: { id: extra.id } });
    }
  });
});

describe('scopeWhere for lists', () => {
  const list = async (user: Ctx, key: string) => ids(await prisma.student.findMany({ where: (await engine.scopeWhere(user, key, 'Student')) as never, select: { id: true } }));

  it('a school-wide grant reaches every student of the school, and never another school\'s', async () => {
    expect(await list(owner, 'students.profiles.view')).toEqual([...stu.f1North, ...stu.f1South, ...stu.f2East].sort());
    expect(await list(owner, 'students.profiles.view')).not.toContain(stu.b[0]);
  });
  it('a teacher (ASSIGNED) reaches only the students of the classes they teach', async () => {
    expect(await list(teacher, 'students.profiles.view')).toEqual([...stu.f1North].sort());
  });
  it('a class teacher (CLASS) reaches only their class', async () => {
    expect(await list(classTeacher, 'students.profiles.view')).toEqual([...stu.f2East].sort());
  });
  it('a head of department (DEPARTMENT) reaches the students taking the department\'s subjects', async () => {
    expect(await list(hod, 'students.profiles.view')).toEqual([...stu.f1South].sort());
  });
  it('a boarding master (HOSTEL) reaches the boarders of their hostel', async () => {
    expect(await list(boardingMaster, 'students.profiles.view')).toEqual([boarderId]);
  });
  it('a person without the key reaches nothing', async () => {
    expect(await list(nobody, 'students.profiles.view')).toEqual([]);
    expect(await list(teacher, 'finance.statements.view')).toEqual([]);
  });
  it('a scope only narrows: a class grant never reaches another class, through a search or an export', async () => {
    const search = await prisma.student.findMany({ where: { AND: [(await engine.scopeWhere(classTeacher, 'students.profiles.view', 'Student')) as never, { fullName: { contains: 'North' } }] }, select: { id: true } });
    expect(search).toEqual([]);
    const exported = await engine.scopeWhere(classTeacher, 'students.profiles.export', 'Student'); // not held: nothing
    expect(ids(await prisma.student.findMany({ where: exported as never, select: { id: true } }))).toEqual([]);
  });
  it('classes and assignments follow the same scopes', async () => {
    const classes = async (u: Ctx, key: string) => ids(await prisma.schoolClass.findMany({ where: (await engine.scopeWhere(u, key, 'SchoolClass')) as never, select: { id: true } }));
    expect(await classes(teacher, 'academics.classes.view')).toEqual([W.f1North]);
    expect(await classes(classTeacher, 'academics.classes.view')).toEqual([W.f2East]);
    expect(await classes(hod, 'academics.classes.view')).toEqual([]); // the HOD role holds no classes key
    const assignments = await prisma.teacherAssignment.findMany({ where: (await engine.scopeWhere(teacher, 'academics.assignments.view', 'TeacherAssignment')) as never });
    expect(assignments.map((a) => a.teacherId)).toEqual([W.teachers.chikore]);
    const dept = await prisma.teacherAssignment.findMany({ where: (await engine.scopeWhere(hod, 'academics.assignments.view', 'TeacherAssignment')) as never });
    expect(dept.every((a) => a.subjectId === W.subjects.maths)).toBe(true);
  });
  it('builds the filter for records a person created or owns', async () => {
    expect(await engine.scopeWhere(clerk, 'finance.payments.record', 'FinPayment')).toEqual({ schoolId: A.schoolId, OR: [{ recordedById: clerk.id }] });
    expect(await engine.scopeWhere(clerk, 'finance.cashup.submit', 'CashUp')).toEqual({ schoolId: A.schoolId, OR: [{ userId: clerk.id }] });
    const self = await engine.reach(clerk, 'SELF');
    expect(await engine.scopeWhere(clerk, 'hr.self.payslips', 'Payslip')).toEqual({ schoolId: A.schoolId, OR: [{ employeeId: self.employeeId }] });
    expect(await engine.scopeWhere(clerk, 'hr.self.leave', 'LeaveRequest')).toEqual({ schoolId: A.schoolId, OR: [{ employeeId: self.employeeId }] });
    expect(await engine.scopeWhere(nobody, 'hr.self.payslips', 'Payslip')).toEqual({ schoolId: A.schoolId, id: { in: [] } });
    expect(await engine.scopeWhere(owner, 'finance.payments.void', 'FinPayment')).toEqual({ schoolId: A.schoolId });
  });
  it('refuses to guess for a model it has no scope map for, unless the grant is school-wide', async () => {
    await expect(engine.scopeWhere(teacher, 'exams.marks.enter', 'Whatever')).rejects.toThrow(/no scope map/);
    expect(await engine.scopeWhere(owner, 'students.profiles.view', 'Whatever')).toEqual({ schoolId: A.schoolId });
    expect(engine.registeredModels()).toEqual(expect.arrayContaining(['Student', 'SchoolClass', 'TeacherAssignment', 'FinPayment', 'CashUp', 'Employee', 'Payslip', 'FacHostel', 'FacStore']));
  });
});

describe('a role pinned to one place', () => {
  it('reaches only that department, class, hostel or store, however many it could', async () => {
    const pinnedHod = await userWithRoles(prisma, A, [], 'pinned');
    const role = await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key: 'HOD' } });
    await prisma.userRole.create({ data: { schoolId: A.schoolId, userId: pinnedHod.id, roleId: role.id, scopeType: 'DEPARTMENT', scopeId: W.dept.humanities } });
    const c = await ctxOf(pinnedHod);
    expect(engine.grantsFor(engine.effectiveOf(c), 'exams.marks.verify')).toEqual([{ scope: 'DEPARTMENT', scopeId: W.dept.humanities }]);
    const r = await engine.reach(c, 'DEPARTMENT', { pins: [W.dept.humanities] });
    expect(r.departmentIds).toEqual([W.dept.humanities]);
    expect(r.subjectIds).toContain(W.subjects.geography);
    expect(r.subjectIds).not.toContain(W.subjects.maths);
    // Another school's department cannot be pinned.
    const other = await prisma.department.create({ data: { schoolId: B.schoolId, name: 'Their Sciences' } });
    expect((await engine.reach(await ctxOf(pinnedHod), 'DEPARTMENT', { pins: [other.id] })).departmentIds).toEqual([]);
  });
});

describe('record checks and their reasons', () => {
  it('another school\'s record is "not found", never "forbidden", even for the Owner', async () => {
    await expect(engine.assertAllowed(owner, 'students.profiles.view', { model: 'Student', id: stu.b[0]! })).rejects.toMatchObject({ status: 404, code: 'OTHER_SCHOOL' });
    await expect(engine.assertAllowed(teacher, 'students.profiles.view', { model: 'Student', id: stu.b[0]! })).rejects.toMatchObject({ status: 404 });
    await expect(engine.assertAllowed(owner, 'students.profiles.view', { model: 'Student', record: { id: stu.b[0]!, schoolId: B.schoolId } })).rejects.toMatchObject({ status: 404 });
    await expect(engine.assertAllowed(owner, 'students.profiles.view', { model: 'Student', id: 'no-such-id' })).rejects.toMatchObject({ status: 404 });
  });
  it('a record inside the scope passes; one outside it is refused with the reason', async () => {
    await expect(engine.assertAllowed(teacher, 'students.profiles.view', { model: 'Student', id: stu.f1North[0]! })).resolves.toBeUndefined();
    await expect(engine.canAccess(teacher, 'students.profiles.view', { model: 'Student', id: stu.f1North[0]! })).resolves.toBe(true);
    await expect(engine.canAccess(teacher, 'students.profiles.view', { model: 'Student', id: stu.f2East[0]! })).resolves.toBe(false);
    await expect(engine.assertAllowed(teacher, 'students.profiles.view', { model: 'Student', id: stu.f2East[0]! })).rejects.toMatchObject({ status: 403, code: 'OUT_OF_SCOPE', message: expect.stringMatching(/outside what you are allowed to see/) });
    await expect(engine.assertAllowed(teacher, 'students.profiles.view', { model: 'Student', id: stu.f2East[0]! }, { hideOutOfScope: true })).rejects.toMatchObject({ status: 404 });
    await expect(engine.assertAllowed(classTeacher, 'students.profiles.view', { model: 'Student', record: { id: stu.f2East[1]!, schoolId: A.schoolId } })).resolves.toBeUndefined();
    await expect(engine.assertAllowed(owner, 'students.profiles.view', { model: 'Student', id: stu.f2East[0]! })).resolves.toBeUndefined();
  });
  it('a key that is not held says what is missing and who can do it instead', async () => {
    const err = await engine.assertAllowed(teacher, 'finance.payments.verify').catch((e) => e);
    expect(err).toMatchObject({ status: 403, code: 'MISSING_PERMISSION', key: 'finance.payments.verify' });
    expect(err.message).toMatch(/verify or reject payments recorded by someone else/i);
    expect(err.message).toMatch(/Ask the Bursar/);
  });
  it('a switched-off module, a suspended school and a support session say so', async () => {
    const off = { ...teacher, disabledModules: ['exams'] };
    await expect(engine.assertAllowed(off, 'exams.marks.enter')).rejects.toMatchObject({ code: 'MODULE_OFF', message: expect.stringMatching(/Examinations is switched off/) });
    const frozen = { ...teacher, readOnly: true };
    await expect(engine.assertAllowed(frozen, 'exams.marks.enter')).rejects.toMatchObject({ code: 'READ_ONLY' });
    await expect(engine.assertAllowed({ ...frozen, support: true } as never, 'exams.marks.enter')).rejects.toMatchObject({ message: expect.stringMatching(/Pfuma support/) });
    await expect(engine.assertAllowed(frozen, 'academics.timetable.view')).resolves.toBeUndefined(); // looking is still allowed
  });
});

describe('exceptions (overrides)', () => {
  it('a GRANT is felt at once; once it expires or is revoked it is not', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'exc');
    const before = await ctxOf(person);
    expect(engine.can(before, 'finance.reports.view')).toBe(false);
    const grant = await prisma.userPermissionOverride.create({
      data: { schoolId: A.schoolId, userId: person.id, permissionKey: 'finance.reports.view', effect: 'GRANT', reason: 'Covering for the bursar', expiresAt: new Date(Date.now() + 5 * 86_400_000), createdById: owner.id },
    });
    expect(engine.can(await ctxOf(person), 'finance.reports.view')).toBe(true);
    await prisma.userPermissionOverride.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    expect(engine.can(await ctxOf(person), 'finance.reports.view')).toBe(false);
  });
  it('a DENY beats the role\'s grant', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'denied');
    expect(engine.can(await ctxOf(person), 'exams.marks.enter')).toBe(true);
    await prisma.userPermissionOverride.create({
      data: { schoolId: A.schoolId, userId: person.id, permissionKey: 'exams.marks.enter', effect: 'DENY', reason: 'Under review', expiresAt: new Date(Date.now() + 5 * 86_400_000), createdById: owner.id },
    });
    const c = await ctxOf(person);
    expect(engine.can(c, 'exams.marks.enter')).toBe(false);
    expect(engine.can(c, 'exams.marks.submit')).toBe(true);
    await expect(engine.assertAllowed(c, 'exams.marks.enter')).rejects.toMatchObject({ message: expect.stringMatching(/exception on your account/) });
  });
  it('single-person finance gives the Owner the keys of a second finance person', async () => {
    const onlyOwner = await userWithRoles(prisma, A, ['OWNER'], 'own');
    expect(engine.effectiveOf(await ctxOf(onlyOwner)).grants.has('finance.payments.verify')).toBe(false);
    await prisma.school.update({ where: { id: A.schoolId }, data: { singlePersonFinance: true } });
    const after = await ctxOf(onlyOwner);
    expect(engine.effectiveOf(after).grants.get('finance.payments.verify')).toEqual([{ scope: 'SCHOOL' }]);
    expect(engine.effectiveOf(after).grants.get('finance.adjustments.approve')).toEqual([{ scope: 'SCHOOL' }]);
    await prisma.school.update({ where: { id: A.schoolId }, data: { singlePersonFinance: false } });
    expect(engine.effectiveOf(await ctxOf(onlyOwner)).grants.has('finance.payments.verify')).toBe(false);
  });
});

describe('last term\'s records', () => {
  it('stay readable to a teacher for the school\'s window after the term changes, to look at only, then drop away', async () => {
    const prev = await prisma.academicTerm.create({
      data: { schoolId: A.schoolId, academicYearId: A.yearId, termNumber: 2, name: 'Term 2 2026', startDate: new Date('2026-05-01'), endDate: new Date('2026-08-01'), status: 'PLANNED' },
    });
    const past = await prisma.teacherAssignment.create({
      data: { schoolId: A.schoolId, termId: prev.id, teacherId: W.teachers.moyo, subjectId: W.subjects.english, classId: W.f1North, periodsPerWeek: 4, startDate: new Date('2026-05-01') },
    });
    await prisma.academicTerm.update({ where: { id: prev.id }, data: { status: 'CLOSED', closedAt: new Date(Date.now() - 10 * 86_400_000) } });
    const person = (days: number) => ctxOf({ id: W.teachers.moyo, schoolId: A.schoolId, email: 'm@x', fullName: 'Moyo', role: 'TEACHER' }).then((c) => ({ ...c, previousTermReadDays: days }));
    const read = async (c: Ctx) => ids(await prisma.teacherAssignment.findMany({ where: (await engine.scopeWhere(c, 'academics.assignments.view', 'TeacherAssignment')) as never }));
    const write = async (c: Ctx) => ids(await prisma.teacherAssignment.findMany({ where: (await engine.scopeWhere(c, 'academics.schemes.edit', 'TeacherAssignment')) as never }));
    expect(await read(await person(30))).toContain(past.id);   // 10 days ago is inside 30
    expect(await write(await person(30))).not.toContain(past.id); // changing needs the open term
    expect(await read(await person(7))).not.toContain(past.id);  // outside a 7-day window
    expect(await read(await person(0))).not.toContain(past.id);
    // The head of department and above are not tied to a term.
    expect(await read(owner)).toContain(past.id);
    // The closed term and its lesson stay: a closed term cannot be changed, which is the point of closing it.
  });
});

describe('the module switch', () => {
  it('is read from SchoolModule and kept for 60 seconds', async () => {
    engine.clearModuleCache();
    const t0 = 1_000_000;
    expect(await engine.moduleEnabled(A.schoolId, 'finance.payments.view', t0)).toBe(true);
    await prisma.schoolModule.upsert({ where: { schoolId_module: { schoolId: A.schoolId, module: 'finance' } }, update: { enabled: false }, create: { schoolId: A.schoolId, module: 'finance', enabled: false } });
    expect(await engine.moduleEnabled(A.schoolId, 'finance.payments.view', t0 + 30_000)).toBe(true);  // still the old answer
    expect(await engine.moduleEnabled(A.schoolId, 'finance.payments.view', t0 + 61_000)).toBe(false); // after a minute
    expect(await engine.moduleEnabled(A.schoolId, 'finance', t0 + 61_000)).toBe(false);
    expect(await engine.moduleEnabled(A.schoolId, 'exams.marks.enter', t0 + 61_000)).toBe(true);
    expect(await engine.moduleEnabled(A.schoolId, 'system.users.view', t0 + 61_000)).toBe(true);
    await prisma.schoolModule.update({ where: { schoolId_module: { schoolId: A.schoolId, module: 'finance' } }, data: { enabled: true } });
    engine.clearModuleCache(A.schoolId);
    expect(await engine.moduleEnabled(A.schoolId, 'finance.payments.view', t0 + 62_000)).toBe(true);
  });
  it('switching off the whole of Facilities hides every part, and one part hides only itself', async () => {
    engine.clearModuleCache();
    await prisma.schoolModule.create({ data: { schoolId: A.schoolId, module: 'facilities.library', enabled: false } });
    expect(await engine.moduleEnabled(A.schoolId, 'facilities.library.view', 5_000_000)).toBe(false);
    expect(await engine.moduleEnabled(A.schoolId, 'facilities.hostel.view', 5_000_000)).toBe(true);
    await prisma.schoolModule.deleteMany({ where: { schoolId: A.schoolId, module: 'facilities.library' } });
    engine.clearModuleCache();
  });
});

describe('refused attempts on sensitive keys', () => {
  const denials = () => prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'ACCESS_DENIED' } });

  it('are written to the audit log; refusals of ordinary keys are not', async () => {
    const before = await denials();
    await engine.assertAllowed(teacher, 'students.medical.view').catch(() => undefined);
    expect(await denials()).toBe(before + 1);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'ACCESS_DENIED' }, orderBy: { createdAt: 'desc' } });
    expect(row).toMatchObject({ actorId: teacher.id, entityType: 'Permission', entityId: 'students.medical.view' });
    await engine.assertAllowed(teacher, 'finance.payments.record').catch(() => undefined); // not sensitive
    expect(await denials()).toBe(before + 1);
  });

  it('ten in five minutes alert the administrators once', async () => {
    const admin = A.users.ADMIN;
    const noisy = await userWithRoles(prisma, A, ['TEACHER'], 'noisy');
    const c = await ctxOf(noisy);
    for (let i = 0; i < 12; i++) await engine.assertAllowed(c, 'hr.pay.view').catch(() => undefined);
    const notes = await prisma.notification.findMany({ where: { userId: admin.id, type: 'ACCESS_DENIED_REPEATED' } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toMatch(/refused \d+ times in five minutes/);
  });

  it('writes a look at sensitive data to the audit log', async () => {
    await engine.logSensitiveRead(owner, 'MEDICAL_VIEWED', 'Student', stu.f1North[0]!, 'Medical tab');
    await engine.logSensitiveRead(owner, 'EXPORT_DATA', 'Student', 'list', 'Student list');
    const rows = await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, actorId: owner.id, action: { in: ['MEDICAL_VIEWED', 'EXPORT_DATA'] } } });
    expect(rows.map((r) => r.action).sort()).toEqual(['EXPORT_DATA', 'MEDICAL_VIEWED']);
  });
});

describe('permVersion', () => {
  it('moves for the people named, and for everyone who holds a role whose grants changed', async () => {
    const { getScopedDb } = await import('@/lib/scoped-db');
    const db = getScopedDb(A.schoolId, owner.id);
    const a = await userWithRoles(prisma, A, ['LIBRARIAN'], 'v1');
    const b = await userWithRoles(prisma, A, ['LIBRARIAN'], 'v2');
    const c = await userWithRoles(prisma, A, ['TEACHER'], 'v3');
    const version = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { permVersion: true } })).permVersion;
    await db.$tx(async (tx) => { await engine.bumpPermVersion(tx, [a.id, a.id]); });
    expect([await version(a.id), await version(b.id), await version(c.id)]).toEqual([1, 0, 0]);
    const librarian = await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key: 'LIBRARIAN' } });
    const n = await db.$tx(async (tx) => engine.bumpHoldersOfRole(tx, librarian.id));
    expect(n).toBeGreaterThanOrEqual(3);
    expect([await version(a.id), await version(b.id), await version(c.id)]).toEqual([2, 1, 0]);
    expect((await ctxOf(a)).permVersion).toBe(2);
  });
});

describe('requirePermission with a record', () => {
  it('checks the scope of the record through the session', async () => {
    const { session } = await import('../helpers/session');
    session.current = { id: teacher.id, schoolId: A.schoolId, role: 'TEACHER', email: 'c@x', fullName: 'Chikore' } as never;
    const fresh = access;
    await expect(fresh.requirePermission('students.profiles.view', { model: 'Student', id: stu.f1North[0]! })).resolves.toMatchObject({ id: teacher.id });
    await expect(fresh.requirePermission('students.profiles.view', { model: 'Student', id: stu.f2East[0]! })).rejects.toMatchObject({ status: 403 });
    await expect(fresh.requirePermission('students.profiles.view', { model: 'Student', id: stu.b[0]! })).rejects.toMatchObject({ status: 404 });
    await expect(fresh.requirePermission('finance.payments.verify')).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/Ask the Bursar/) });
    session.current = null as never;
    await expect(fresh.requirePermission('students.profiles.view')).rejects.toBeInstanceOf(Response);
  });
});

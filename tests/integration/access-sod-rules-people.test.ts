// @vitest-environment node
// Separation-of-duties rules 5 to 9 in the People (HR), Exams and Access areas, driven through the real services. As in
// access-sod-rules.test.ts, each rule is tried by a person who holds exactly the permissions the steps need, by the Owner and by
// the Administrator: the rules are about identity, so a role that holds everything is no exception.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, userWithRoles, type SeededSchool } from '../helpers/seed';
import { actorOf } from '../helpers/academics';
import { hrWorld, type HrWorld } from '../helpers/hr';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let W: HrWorld;
let prisma: typeof import('@/lib/prisma').prisma;
let emp: typeof import('@/lib/hr/employees');
let leave: typeof import('@/lib/hr/leave');
let duties: typeof import('@/lib/hr/duties');
let run: typeof import('@/lib/payroll/run');
let sheets: typeof import('@/lib/exams/sheets');
let access: typeof import('@/lib/system/access-admin');
let users: typeof import('@/lib/system/users');
let scoped: typeof import('@/lib/scoped-db');
let vacationId = '';

type Actor = HrWorld['owner'];
let counter = 0;

/** A person whose only permissions are `keys`, through a custom role. */
async function holder(keys: string[]): Promise<Actor> {
  const n = ++counter;
  const key = `SOD_PEOPLE_${'X'.repeat(n)}`;
  const role = await prisma.roleDefinition.create({ data: { schoolId: A.schoolId, key, name: `People holder ${n}`, description: 'Test role', isSystem: false } });
  await prisma.rolePermission.createMany({ data: keys.map((permissionKey) => ({ schoolId: A.schoolId, roleId: role.id, permissionKey, scope: 'SCHOOL' as const })) });
  const person = await userWithRoles(prisma, A, [key], `peopleholder${n}`);
  return actorOf(prisma, person.id);
}


/**
 * The Owner and the Administrator no longer hold "*", so neither holds both steps of a rule on its own. The way one person comes to hold
 * both is an exception (a time-limited grant of the missing permissions), so that is how they are given them here: the rules are about
 * identity, and an exception must not be a way round them.
 */
async function exceptionally(person: Actor, keys: string[]): Promise<Actor> {
  const missing = keys.filter((k) => !(person.grants ?? []).includes(k));
  if (!missing.length) return person;
  await prisma.userPermissionOverride.createMany({
    data: missing.map((permissionKey) => ({ schoolId: A.schoolId, userId: person.id, permissionKey, effect: 'GRANT' as const, reason: 'Separation-of-duties test', expiresAt: new Date(Date.now() + 80 * 86_400_000), createdById: A.users.HEAD.id })),
    skipDuplicates: true,
  });
  return actorOf(prisma, person.id);
}

const people = (keys: string[]) =>
  [
    ['a person holding just these permissions', () => holder(keys)],
    ['the Owner', () => exceptionally(W.owner, keys)],
    ['the Administrator', () => exceptionally(W.admin, keys)],
  ] as const;

type Refusal = { status?: number; message: string } | null;
const refusal = (p: Promise<unknown>): Promise<Refusal> => p.then(() => null, (x) => x as Refusal);

const blocked = async (p: Promise<unknown>, match: RegExp) => {
  const e = await refusal(p);
  expect(e, 'the second step should have been refused').not.toBeNull();
  expect(e!.status).toBe(403);
  expect(e!.message).toMatch(match);
};

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  [emp, leave, duties, run, sheets, access, users, scoped] = await Promise.all([
    import('@/lib/hr/employees'), import('@/lib/hr/leave'), import('@/lib/hr/duties'), import('@/lib/payroll/run'),
    import('@/lib/exams/sheets'), import('@/lib/system/access-admin'), import('@/lib/system/users'), import('@/lib/scoped-db'),
  ]);
  A = await seedSchool(prisma, 'School A');
  W = await hrWorld(prisma, A);
  await (await import('@/lib/payroll/settings-service')).getPayrollSettings(W.hr); // makes the school's starting lists, leave types included
  vacationId = (await prisma.leaveType.findFirstOrThrow({ where: { schoolId: A.schoolId, code: 'VACATION' } })).id;
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

/** A staff record linked to the login of `a`, so `a` is that employee. */
const employeeFor = async (a: Actor) => {
  const existing = await prisma.employee.findFirst({ where: { schoolId: A.schoolId, userId: a.id }, select: { id: true } });
  if (existing) return existing.id;
  const e = await emp.createEmployee(W.hr, { firstName: `Staff${++counter}`, surname: 'Member', jobTitle: 'Groundsman', category: 'GROUNDS', employer: 'SCHOOL', startDate: '2026-02-01' });
  await prisma.employee.update({ where: { id: e.id }, data: { userId: a.id } });
  return e.id;
};

describe('rule 5: the person who prepared a payroll run does not approve it or send it back', () => {
  for (const [name, who] of people(['hr.payroll.approve'])) {
    it(`${name} cannot approve or return a run they prepared`, async () => {
      const a = await who();
      const r = await prisma.hrPayrollRun.create({ data: { schoolId: A.schoolId, month: `2032-${String(++counter).padStart(2, '0')}`, preparedById: a.id, status: 'SUBMITTED', submittedAt: new Date() } as never });
      // Full access never reaches payroll approval, so the Administrator is stopped even earlier, by the missing permission.
      const approve = await refusal(run.approveRun(a, r.id));
      expect(approve?.status).toBe(403);
      const back = await refusal(run.returnRun(a, r.id, { comment: 'Please check again' }));
      expect(back?.status).toBe(403);
      if (name !== 'the Administrator') {
        expect(approve?.message).toMatch(/You prepared this payroll, so someone else must approve it/);
        expect(back?.message).toMatch(/You prepared this payroll, so someone else must decide on it/);
      }
      expect((await prisma.hrPayrollRun.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('SUBMITTED');
    });
  }
});

/** A subject taught to a class of its own, so no two assignments clash. */
const teaching = async (who: { teacherId: string; coTeacherId?: string }) => {
  const cls = await prisma.schoolClass.create({ data: { schoolId: A.schoolId, name: `Form 1 Stream ${++counter}`, levelId: A.levelId, stream: `S${counter}` } });
  return prisma.teacherAssignment.create({
    data: { schoolId: A.schoolId, termId: A.termId, teacherId: who.teacherId, coTeacherId: who.coTeacherId ?? null, subjectId: A.subjectId, classId: cls.id, periodsPerWeek: 4, doublesPerWeek: 0, startDate: new Date('2026-09-01') },
  });
};

describe('rule 6: the person who teaches a class does not verify its mark sheet', () => {
  for (const [name, who] of people(['exams.marks.verify'])) {
    it(`${name} cannot verify the marks of a class they teach`, async () => {
      const a = await who();
      const assignment = await teaching({ teacherId: a.id });
      await blocked(sheets.verifySheet(a, assignment.id), /You cannot verify your own marks/);
    });
    it(`${name} cannot verify the marks of a class they co-teach`, async () => {
      const a = await who();
      const assignment = await teaching({ teacherId: W.teacher.id, coTeacherId: a.id });
      await blocked(sheets.verifySheet(a, assignment.id), /You cannot verify your own marks/);
    });
  }
});

describe('rule 7: nobody approves their own leave or duty swap', () => {
  for (const [name, who] of people(['hr.leave.approve'])) {
    it(`${name} cannot approve their own leave, or leave they asked for on someone else's behalf`, async () => {
      const a = await who();
      const mine = await employeeFor(a);
      const own = await prisma.leaveRequest.create({ data: { schoolId: A.schoolId, employeeId: mine, leaveTypeId: vacationId, startDate: new Date('2032-03-02'), endDate: new Date('2032-03-02'), days: 1, requestedById: a.id } });
      await blocked(leave.decideLeave(a, own.id, { decision: 'APPROVE' }), /Nobody approves their own leave/);
      const other = await employeeFor(W.teacher2);
      const forOther = await prisma.leaveRequest.create({ data: { schoolId: A.schoolId, employeeId: other, leaveTypeId: vacationId, startDate: new Date('2032-03-03'), endDate: new Date('2032-03-03'), days: 1, requestedById: a.id } });
      await blocked(leave.decideLeave(a, forOther.id, { decision: 'APPROVE' }), /Nobody approves their own leave/);
      expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: own.id } })).status).toBe('PENDING');
    });
  }

  for (const [name, who] of people(['hr.duties.manage'])) {
    it(`${name} cannot confirm a duty swap they are part of`, async () => {
      const a = await who();
      const mine = await employeeFor(a);
      const theirs = await employeeFor(W.teacher2);
      const roster = await duties.createRoster(W.deputy, { label: `Week ${++counter}`, startDate: '2032-05-03', endDate: '2032-05-07' });
      const types = await duties.listDutyTypes(W.deputy);
      const swap = async (from: string, to: string) => {
        const assignment = await prisma.dutyAssignment.create({ data: { schoolId: A.schoolId, rosterId: roster.id, dutyTypeId: types[0]!.id, date: new Date('2032-05-04'), employeeId: from } as never });
        return prisma.dutySwap.create({ data: { schoolId: A.schoolId, assignmentId: assignment.id, fromEmployeeId: from, toEmployeeId: to, status: 'ACCEPTED' } as never });
      };
      const asker = await swap(mine, theirs);
      await blocked(duties.confirmSwap(a, asker.id), /duty swap/);
      const taker = await swap(theirs, mine);
      await blocked(duties.confirmSwap(a, taker.id), /duty swap/);
      expect((await prisma.dutySwap.findUniqueOrThrow({ where: { id: asker.id } })).status).toBe('ACCEPTED');
    });
  }
});

describe('rule 8: nobody changes their own roles, permissions or exceptions', () => {
  for (const [name, who] of people(['system.users.edit'])) {
    it(`${name} cannot give themselves a role, take one away, edit their roles or make an exception for themselves`, async () => {
      const a = await who();
      const db = scoped.getScopedDb(a.schoolId, a.id);
      await blocked(access.assignRole(db, a, a.id, { roleKey: 'LIBRARIAN' }), /cannot change your own roles/);
      const mine = await prisma.userRole.findFirstOrThrow({ where: { userId: a.id } });
      await blocked(access.removeRole(db, a, a.id, mine.id), /cannot change your own roles/);
      await blocked(access.createOverride(db, a, a.id, { permissionKey: 'hr.leave.view_all', effect: 'GRANT', reason: 'For myself', days: 5 }), /cannot change your own/);
      await blocked(users.updateUser(db, a, a.id, { roles: ['LIBRARIAN'] }), /cannot change your own roles/);
    });
  }
});

describe('rule 9: a bank change is approved by HR and then the Owner, two different people', () => {
  it('HR cannot do both steps, the Administrator is not the second, and the Owner cannot decide their own request', async () => {
    const teacher = await employeeFor(W.teacher2);
    await emp.setPay(W.hr, teacher, { paymentMethod: 'BANK', bankName: 'CBZ', accountNumber: '1111111111', basicUsdCents: 50000, reason: 'Initial set-up' });
    const asked = await emp.requestChange(W.teacher2, { group: 'BANK', changes: { paymentMethod: 'BANK', bankName: 'Stanbic', accountNumber: '2222222222' } });
    expect((await emp.decideChange(W.hr, asked.id, { decision: 'APPROVE' })).status).toBe('HR_APPROVED');
    await blocked(emp.decideChange(W.hr, asked.id, { decision: 'APPROVE' }), /HR and the Owner|cannot do both/);
    await blocked(emp.decideChange(W.admin, asked.id, { decision: 'APPROVE' }), /HR and the Owner/);
    expect((await prisma.employeePay.findUniqueOrThrow({ where: { employeeId: teacher } })).accountNumber).toBe('1111111111');
    expect((await emp.decideChange(W.owner, asked.id, { decision: 'APPROVE' })).status).toBe('APPROVED');

    const ownerEmployee = await employeeFor(W.owner);
    await emp.setPay(W.hr, ownerEmployee, { paymentMethod: 'BANK', bankName: 'CBZ', accountNumber: '3333333333', basicUsdCents: 50000, reason: 'Initial set-up' });
    const own = await emp.requestChange(W.owner, { group: 'BANK', changes: { paymentMethod: 'BANK', bankName: 'Stanbic', accountNumber: '4444444444' } });
    await blocked(emp.decideChange(W.owner, own.id, { decision: 'APPROVE' }), /cannot decide your own request/);
  });
});

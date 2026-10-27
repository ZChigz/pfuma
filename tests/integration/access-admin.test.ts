// @vitest-environment node
// Managing access safely: custom roles, the roles a person holds (and the place each applies to), exceptions, requests for access,
// the "what can this user do" view and the weekly summary. Every rule is checked here as the Administrator and as the Owner.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, userWithRoles, type SeededSchool } from '../helpers/seed';
import { actorOf, buildWorld, type World } from '../helpers/academics';
import { call } from '../helpers/route';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let W: World;
let prisma: typeof import('@/lib/prisma').prisma;
let svc: typeof import('@/lib/system/access-admin');
let scoped: typeof import('@/lib/scoped-db');
let access: typeof import('@/lib/access');

type Ctx = Awaited<ReturnType<typeof actorOf>>;
let admin: Ctx, owner: Ctx, limited: Ctx;
const dbOf = (c: { schoolId: string; id: string }) => scoped.getScopedDb(c.schoolId, c.id);
const fails = async (p: Promise<unknown>, status: number, match?: RegExp) => {
  const e = await p.then(() => null, (x) => x as { status?: number; message: string; name?: string });
  expect(e, 'expected the call to fail').not.toBeNull();
  const got = e!.name === 'ZodError' ? 422 : e!.status;
  expect(got).toBe(status);
  if (match) expect(e!.message).toMatch(match);
};
const version = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { permVersion: true } })).permVersion;
const grantsOf = async (key: string) => Object.fromEntries((await prisma.rolePermission.findMany({ where: { schoolId: A.schoolId, role: { key } } })).map((p) => [p.permissionKey, p.scope as string]));
const audit = (action: string, entityId?: string) => prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: action as never, ...(entityId ? { entityId } : {}) }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  svc = await import('@/lib/system/access-admin');
  scoped = await import('@/lib/scoped-db');
  access = await import('@/lib/access');
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  W = await buildWorld(prisma, A);
  admin = await actorOf(prisma, A.users.ADMIN.id);
  owner = await actorOf(prisma, A.users.DIRECTOR.id);
  // Until the full-access shortcut is removed (step 8) the Administrator holds every key, so the rules that separate the
  // Administrator from the Owner are checked as someone who manages users but cannot edit roles.
  const role = await prisma.roleDefinition.create({ data: { schoolId: A.schoolId, key: 'USER_MANAGER', name: 'User manager', description: 'Test role', isSystem: false } });
  await prisma.rolePermission.createMany({ data: ['system.users.edit', 'system.users.view', 'system.roles.view'].map((permissionKey) => ({ schoolId: A.schoolId, roleId: role.id, permissionKey, scope: 'SCHOOL' as const })) });
  limited = await actorOf(prisma, (await userWithRoles(prisma, A, ['USER_MANAGER'], 'limited')).id);
}, 300_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('custom roles', () => {
  let seniorKey: string;

  it('the Administrator copies a role into a custom role that keeps what the original grants', async () => {
    const r = await svc.copyRole(dbOf(admin), admin, { fromKey: 'TEACHER', name: 'Senior Teacher', description: 'Teachers who also mentor.' });
    seniorKey = r.key;
    expect(seniorKey).toBe('SENIOR_TEACHER');
    const role = await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key: seniorKey } });
    const source = await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key: 'TEACHER' } });
    expect(role).toMatchObject({ isSystem: false, name: 'Senior Teacher', copiedFromRoleId: source.id });
    expect(await grantsOf(seniorKey)).toEqual(await grantsOf('TEACHER'));
    const entry = (await audit('ACCESS_ROLE_SAVED', role.id))[0]!;
    expect(entry.after).toMatchObject({ key: seniorKey, copiedFrom: 'TEACHER' });
  });

  it('a name that is taken gets a free key', async () => {
    expect((await svc.copyRole(dbOf(admin), admin, { fromKey: 'TEACHER', name: 'Senior Teacher' })).key).toBe('SENIOR_TEACHER_X');
  });

  it('copying a protected role is the Owner\'s, and no role holds the wildcard any more', async () => {
    await fails(svc.copyRole(dbOf(admin), admin, { fromKey: 'BURSAR', name: 'My Bursar' }), 403, /Only the Owner/);
    await fails(svc.copyRole(dbOf(admin), admin, { fromKey: 'HEAD', name: 'My Head' }), 403);
    // Nobody holds "*" now, so even the Owner role is a list of keys and can be copied (by the Owner); a copy never carries more than the original.
    const ownerCopy = await svc.copyRole(dbOf(owner), owner, { fromKey: 'OWNER', name: 'Copy of owner' });
    expect(Object.keys(await grantsOf(ownerCopy.key)).sort()).toEqual(Object.keys(await grantsOf('OWNER')).sort());
    expect(Object.keys(await grantsOf(ownerCopy.key))).not.toContain('*');
    expect((await svc.copyRole(dbOf(owner), owner, { fromKey: 'BURSAR', name: 'Fees Officer' })).key).toBe('FEES_OFFICER');
  });

  it('the Administrator may take permissions out, and the people who hold the role pick it up', async () => {
    const holder = await userWithRoles(prisma, A, [], 'holder');
    const roleId = (await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key: seniorKey } })).id;
    await prisma.userRole.create({ data: { schoolId: A.schoolId, userId: holder.id, roleId } });
    const before = await grantsOf(seniorKey);
    const { 'exams.marks.submit': _dropped, ...rest } = before;
    const v0 = await version(holder.id);
    const r = await svc.saveCustomRole(dbOf(admin), admin, seniorKey, { grants: Object.entries(rest).map(([key, scope]) => ({ key, scope: scope as never })) });
    expect(r).toMatchObject({ changedGrants: true, peopleAffected: 1 });
    expect(await grantsOf(seniorKey)).toEqual(rest);
    expect(await version(holder.id)).toBe(v0 + 1);
    const entry = (await audit('ACCESS_ROLE_SAVED', roleId)).pop()!;
    expect((entry.before as { grants: string[] }).grants).toContain('exams.marks.submit@ASSIGNED');
    expect((entry.after as { grants: string[] }).grants).not.toContain('exams.marks.submit@ASSIGNED');
    await prisma.userRole.deleteMany({ where: { userId: holder.id, roleId } });
  });

  it('only the Owner may add a permission the copied role did not have, or widen a grant', async () => {
    const keep = Object.entries(await grantsOf(seniorKey)).map(([key, scope]) => ({ key, scope: scope as never }));
    await fails(svc.saveCustomRole(dbOf(limited), limited, seniorKey, { grants: [...keep, { key: 'system.users.export', scope: 'SCHOOL' }] }), 403, /only the Owner/i);
    await fails(svc.saveCustomRole(dbOf(limited), limited, seniorKey, { grants: keep.map((g) => (g.key === 'exams.marks.enter' ? { ...g, scope: 'SCHOOL' as never } : g)) }), 403, /only the Owner/i);
    // Narrowing is the Administrator's.
    await svc.saveCustomRole(dbOf(limited), limited, seniorKey, { grants: keep.map((g) => (g.key === 'exams.marks.enter' ? { ...g, scope: 'SELF' as never } : g)) });
    expect((await grantsOf(seniorKey))['exams.marks.enter']).toBe('SELF');
    // The Owner may add and widen.
    await svc.saveCustomRole(dbOf(owner), owner, seniorKey, { grants: [...keep, { key: 'system.users.export', scope: 'SCHOOL' }] });
    expect((await grantsOf(seniorKey))['system.users.export']).toBe('SCHOOL');
    expect((await grantsOf(seniorKey))['exams.marks.enter']).toBe('ASSIGNED');
  });

  it('finance and staff-pay permissions are the Owner\'s to give, even inside a role the Administrator may edit', async () => {
    const keep = Object.entries(await grantsOf(seniorKey)).map(([key, scope]) => ({ key, scope: scope as never }));
    await fails(svc.saveCustomRole(dbOf(admin), admin, seniorKey, { grants: [...keep, { key: 'finance.reports.view', scope: 'SCHOOL' }] }), 403);
  });

  it('refuses full access, the parent-portal scope and unknown keys', async () => {
    await fails(svc.saveCustomRole(dbOf(owner), owner, seniorKey, { grants: [{ key: '*', scope: 'SCHOOL' }] }), 422, /full access/);
    await fails(svc.saveCustomRole(dbOf(owner), owner, seniorKey, { grants: [{ key: 'system.dashboard.view', scope: 'CHILDREN' }] }), 422);
    await fails(svc.saveCustomRole(dbOf(owner), owner, seniorKey, { grants: [{ key: 'made.up.key', scope: 'SCHOOL' }] }), 422);
  });

  it('system roles cannot be edited or deleted by anyone, the Owner included', async () => {
    for (const actor of [admin, owner]) {
      await fails(svc.saveCustomRole(dbOf(actor), actor, 'TEACHER', { name: 'Renamed' }), 403, /System roles cannot be changed/);
      await fails(svc.saveCustomRole(dbOf(actor), actor, 'TEACHER', { grants: [] }), 403);
      await fails(svc.deleteCustomRole(dbOf(actor), actor, 'TEACHER'), 403);
    }
    expect((await grantsOf('TEACHER'))['exams.marks.enter']).toBe('ASSIGNED');
  });

  it('a custom role is renamed in place, and deleted only when nobody holds it', async () => {
    await svc.saveCustomRole(dbOf(admin), admin, seniorKey, { name: 'Mentor Teacher', description: 'Mentors new teachers.' });
    expect(await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key: seniorKey } })).toMatchObject({ name: 'Mentor Teacher', description: 'Mentors new teachers.' });
    const holder = await userWithRoles(prisma, A, [seniorKey], 'mentor');
    await fails(svc.deleteCustomRole(dbOf(admin), admin, seniorKey), 409, /1 person holds this role/);
    await prisma.userRole.deleteMany({ where: { userId: holder.id } });
    await svc.deleteCustomRole(dbOf(admin), admin, seniorKey);
    expect(await prisma.roleDefinition.count({ where: { schoolId: A.schoolId, key: seniorKey } })).toBe(0);
    await fails(svc.saveCustomRole(dbOf(admin), admin, 'NO_SUCH_ROLE', { name: 'x y' }), 404);
  });
});

describe('the roles a person holds', () => {
  it('gives a role for the whole school or pinned to one department, class, hostel or store, and records who gave it', async () => {
    const person = await userWithRoles(prisma, A, [], 'pin');
    const v0 = await version(person.id);
    const r = await svc.assignRole(dbOf(admin), admin, person.id, { roleKey: 'HOD', scopeType: 'DEPARTMENT', scopeId: W.dept.sciences });
    const row = await prisma.userRole.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ scopeType: 'DEPARTMENT', scopeId: W.dept.sciences, assignedById: admin.id });
    expect(await version(person.id)).toBe(v0 + 1);
    // Their permissions follow the pin.
    const ctx = await actorOf(prisma, person.id);
    const eff = (await import('@/lib/access/effective')).grantsFor(ctx.effective!, 'exams.marks.verify');
    expect(eff).toEqual([{ scope: 'DEPARTMENT', scopeId: W.dept.sciences }]);
    const entry = (await audit('ACCESS_ROLE_ASSIGNED', person.id)).pop()!;
    expect(entry.after).toMatchObject({ added: { role: 'HOD', scopeType: 'DEPARTMENT', scopeId: W.dept.sciences } });
    expect((entry.before as { roles: string[] }).roles).toEqual([]);

    const klass = await svc.assignRole(dbOf(admin), admin, person.id, { roleKey: 'CLASS_TEACHER', scopeType: 'CLASS', scopeId: W.f2East });
    expect((await prisma.userRole.findUniqueOrThrow({ where: { id: klass.id } })).scopeId).toBe(W.f2East);
    const whole = await svc.assignRole(dbOf(admin), admin, person.id, { roleKey: 'TEACHER' });
    expect(await prisma.userRole.findUniqueOrThrow({ where: { id: whole.id } })).toMatchObject({ scopeType: 'SCHOOL', scopeId: '' });
  });

  it('keeps the older single access level in step', async () => {
    const person = await userWithRoles(prisma, A, [], 'level');
    await svc.assignRole(dbOf(admin), admin, person.id, { roleKey: 'LIBRARIAN' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).role).toBe('LIBRARIAN');
  });

  it('checks the place: it must exist in this school and suit the role', async () => {
    const person = await userWithRoles(prisma, A, [], 'place');
    await fails(svc.assignRole(dbOf(admin), admin, person.id, { roleKey: 'HOD', scopeType: 'DEPARTMENT', scopeId: 'nowhere' }), 404);
    await fails(svc.assignRole(dbOf(admin), admin, person.id, { roleKey: 'HOD', scopeType: 'DEPARTMENT' }), 422, /Choose the department/);
    await fails(svc.assignRole(dbOf(admin), admin, person.id, { roleKey: 'HOD', scopeType: 'CLASS', scopeId: W.f1South }), 422, /does not apply to one class/);
    await fails(svc.assignRole(dbOf(admin), admin, person.id, { roleKey: 'LIBRARIAN', scopeType: 'DEPARTMENT', scopeId: W.dept.sciences }), 422);
    const other = await prisma.department.create({ data: { schoolId: B.schoolId, name: 'Their department' } });
    await fails(svc.assignRole(dbOf(admin), admin, person.id, { roleKey: 'HOD', scopeType: 'DEPARTMENT', scopeId: other.id }), 404);
    await svc.assignRole(dbOf(admin), admin, person.id, { roleKey: 'HOD', scopeType: 'DEPARTMENT', scopeId: W.dept.languages });
    await fails(svc.assignRole(dbOf(admin), admin, person.id, { roleKey: 'HOD', scopeType: 'DEPARTMENT', scopeId: W.dept.languages }), 409, /already holds/);
    await fails(svc.assignRole(dbOf(admin), admin, 'no-such-user', { roleKey: 'TEACHER' }), 404);
    await fails(svc.assignRole(dbOf(admin), admin, (await userWithRoles(prisma, B, [], 'other')).id, { roleKey: 'TEACHER' }), 404);
  });

  it('only the Owner gives or takes away Owner, Head, Bursar and Administrator', async () => {
    const person = await userWithRoles(prisma, A, [], 'protected');
    for (const roleKey of ['OWNER', 'HEAD', 'BURSAR', 'ADMINISTRATOR']) {
      await fails(svc.assignRole(dbOf(admin), admin, person.id, { roleKey }), 403, /Only the Owner can give or take away/);
    }
    expect(await prisma.userRole.count({ where: { userId: person.id } })).toBe(0);
    const given = await svc.assignRole(dbOf(owner), owner, person.id, { roleKey: 'BURSAR' });
    await fails(svc.removeRole(dbOf(admin), admin, person.id, given.id), 403, /Only the Owner/);
    await svc.removeRole(dbOf(owner), owner, person.id, given.id);
    expect(await prisma.userRole.count({ where: { userId: person.id } })).toBe(0);
    expect((await audit('ACCESS_ROLE_REMOVED', person.id)).pop()!.before).toMatchObject({ removed: { role: 'BURSAR' } });
  });

  it('nobody changes their own roles, the Owner and the Administrator included', async () => {
    await fails(svc.assignRole(dbOf(admin), admin, admin.id, { roleKey: 'TEACHER' }), 403, /cannot change your own roles/);
    await fails(svc.assignRole(dbOf(owner), owner, owner.id, { roleKey: 'BURSAR' }), 403, /cannot change your own roles/);
    const mine = await prisma.userRole.findFirstOrThrow({ where: { userId: owner.id } });
    await fails(svc.removeRole(dbOf(owner), owner, owner.id, mine.id), 403, /cannot change your own roles/);
  });

  it('the school keeps at least one active Owner and one active Administrator', async () => {
    const onlyAdmin = await prisma.userRole.findFirstOrThrow({ where: { userId: A.users.ADMIN.id, role: { key: 'ADMINISTRATOR' } } });
    await fails(svc.removeRole(dbOf(owner), owner, A.users.ADMIN.id, onlyAdmin.id), 409, /at least one active Administrator/);
    // With a second Administrator it is allowed, and the second one cannot then be removed.
    const second = await userWithRoles(prisma, A, ['ADMINISTRATOR'], 'admin2');
    const secondRow = await prisma.userRole.findFirstOrThrow({ where: { userId: second.id } });
    await svc.removeRole(dbOf(owner), owner, A.users.ADMIN.id, onlyAdmin.id);
    await fails(svc.removeRole(dbOf(owner), owner, second.id, secondRow.id), 409, /at least one active Administrator/);
    await prisma.userRole.create({ data: { schoolId: A.schoolId, userId: A.users.ADMIN.id, roleId: onlyAdmin.roleId } });
    await prisma.userRole.deleteMany({ where: { userId: second.id } });
  });

  it('the users page cannot get round these rules: a protected role by the Administrator, and a change to your own roles, are refused', async () => {
    const { updateUser } = await import('@/lib/system/users');
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'viaUsers');
    await fails(updateUser(dbOf(admin), admin, person.id, { roles: ['TEACHER', 'HEAD'] }), 403, /Only the Owner/);
    await fails(updateUser(dbOf(admin), admin, admin.id, { roles: ['ADMINISTRATOR', 'TEACHER'] }), 403, /cannot change your own roles/);
    await updateUser(dbOf(owner), owner, person.id, { roles: ['TEACHER', 'HEAD'] });
    expect((await prisma.userRole.findMany({ where: { userId: person.id }, select: { role: { select: { key: true } } } })).map((r) => r.role.key).sort()).toEqual(['HEAD', 'TEACHER']);
  });
});

describe('exceptions to access', () => {
  const exc = (over: Record<string, unknown> = {}) => ({ permissionKey: 'hr.leave.view_all', effect: 'GRANT', reason: 'Covering for the HR officer', days: 30, ...over }) as never;

  it('gives one permission for a number of days, with a reason, and tells the person', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'exc1');
    expect((await actorOf(prisma, person.id)).grants).not.toContain('hr.leave.view_all');
    const v0 = await version(person.id);
    const r = await svc.createOverride(dbOf(admin), admin, person.id, exc());
    const row = await prisma.userPermissionOverride.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ userId: person.id, permissionKey: 'hr.leave.view_all', effect: 'GRANT', scope: 'SCHOOL', reason: 'Covering for the HR officer', createdById: admin.id, revokedAt: null });
    expect(Math.round((row.expiresAt.getTime() - row.createdAt.getTime()) / 86_400_000)).toBe(30);
    expect(await version(person.id)).toBe(v0 + 1);
    expect((await actorOf(prisma, person.id)).grants).toContain('hr.leave.view_all');
    const entry = (await audit('ACCESS_OVERRIDE_SAVED', person.id)).pop()!;
    expect(entry.after).toMatchObject({ permissionKey: 'hr.leave.view_all', effect: 'GRANT', reason: 'Covering for the HR officer' });
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: person.id, type: 'ACCESS' } })).title).toMatch(/temporary access/);
  });

  it('refuses more than 90 days, no days, no reason, a made-up permission, and your own', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'exc2');
    await fails(svc.createOverride(dbOf(admin), admin, person.id, exc({ days: 91 })), 422);
    await fails(svc.createOverride(dbOf(admin), admin, person.id, exc({ days: 0 })), 422);
    await fails(svc.createOverride(dbOf(admin), admin, person.id, exc({ reason: '  ' })), 422);
    await fails(svc.createOverride(dbOf(admin), admin, person.id, exc({ permissionKey: 'made.up.key' })), 422);
    await fails(svc.createOverride(dbOf(admin), admin, admin.id, exc()), 403, /cannot change your own/);
    await fails(svc.createOverride(dbOf(admin), admin, 'nobody', exc()), 404);
    await fails(svc.createOverride(dbOf(admin), admin, (await userWithRoles(prisma, B, [], 'otherschool')).id, exc()), 404);
    expect(await prisma.userPermissionOverride.count({ where: { userId: person.id } })).toBe(0);
  });

  it('money and staff-pay permissions are the Owner\'s to give or deny', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'exc3');
    for (const permissionKey of ['finance.payments.void', 'hr.pay.view', 'hr.payroll.approve', 'system.roles.edit']) {
      await fails(svc.createOverride(dbOf(admin), admin, person.id, exc({ permissionKey })), 403, /given by the Owner only/);
    }
    const r = await svc.createOverride(dbOf(owner), owner, person.id, exc({ permissionKey: 'finance.reports.view' }));
    await fails(svc.revokeOverride(dbOf(admin), admin, r.id), 403);
    await svc.revokeOverride(dbOf(owner), owner, r.id);
  });

  it('a deny beats the role\'s grant and a grant to the same person', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'exc4');
    expect((await actorOf(prisma, person.id)).grants).toContain('exams.marks.enter');
    await svc.createOverride(dbOf(admin), admin, person.id, exc({ permissionKey: 'exams.marks.enter', effect: 'GRANT' }));
    await svc.createOverride(dbOf(admin), admin, person.id, exc({ permissionKey: 'exams.marks.enter', effect: 'DENY', reason: 'Marks under review' }));
    const ctx = await actorOf(prisma, person.id);
    expect(access.can(ctx, 'exams.marks.enter')).toBe(false);
    expect(access.can(ctx, 'exams.marks.submit')).toBe(true);
  });

  it('names the place for a department, class, hostel or store exception, and nowhere else', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'exc5');
    await fails(svc.createOverride(dbOf(admin), admin, person.id, exc({ scope: 'CLASS' })), 422, /Choose the class/);
    await fails(svc.createOverride(dbOf(admin), admin, person.id, exc({ scope: 'SCHOOL', scopeId: W.f2East })), 422);
    await fails(svc.createOverride(dbOf(admin), admin, person.id, exc({ scope: 'CLASS', scopeId: 'nowhere' })), 404);
    await fails(svc.createOverride(dbOf(admin), admin, person.id, exc({ scope: 'CHILDREN' })), 422);
    const ok = await svc.createOverride(dbOf(admin), admin, person.id, exc({ permissionKey: 'students.profiles.view', scope: 'CLASS', scopeId: W.f2East }));
    expect(await prisma.userPermissionOverride.findUniqueOrThrow({ where: { id: ok.id } })).toMatchObject({ scope: 'CLASS', scopeId: W.f2East });
  });

  it('ends an exception now; it stays in the history and cannot be ended twice', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'exc6');
    const r = await svc.createOverride(dbOf(admin), admin, person.id, exc());
    await svc.revokeOverride(dbOf(admin), admin, r.id);
    expect((await prisma.userPermissionOverride.findUniqueOrThrow({ where: { id: r.id } })).revokedAt).not.toBeNull();
    expect((await actorOf(prisma, person.id)).grants).not.toContain('hr.leave.view_all');
    await fails(svc.revokeOverride(dbOf(admin), admin, r.id), 409);
    await fails(svc.revokeOverride(dbOf(admin), admin, 'nope'), 404);
    expect((await audit('ACCESS_OVERRIDE_REVOKED', person.id)).pop()!.after).toMatchObject({ revoked: true });
  });

  it('stops working by itself when it expires, and stays in the history', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'exc7');
    const past = new Date(Date.now() - 20 * 86_400_000);
    await prisma.userPermissionOverride.create({
      data: { schoolId: A.schoolId, userId: person.id, permissionKey: 'hr.leave.view_all', effect: 'GRANT', reason: 'Old cover', createdAt: past, expiresAt: new Date(past.getTime() + 10 * 86_400_000), createdById: owner.id },
    });
    expect((await actorOf(prisma, person.id)).grants).not.toContain('hr.leave.view_all');
    const active = await svc.listExceptions(dbOf(admin));
    expect(active.some((r) => r.userId === person.id)).toBe(false);
    const history = await svc.listExceptions(dbOf(admin), { history: true });
    expect(history.find((r) => r.userId === person.id)).toMatchObject({ state: 'EXPIRED', reason: 'Old cover' });
  });

  it('the active-exceptions report lists what is in force, with who gave it and until when', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'exc8');
    const r = await svc.createOverride(dbOf(admin), admin, person.id, exc({ days: 10 }));
    const row = (await svc.listExceptions(dbOf(admin))).find((x) => x.id === r.id)!;
    expect(row).toMatchObject({ userName: person.fullName, label: 'See every leave request and balance', state: 'ACTIVE', createdBy: admin.fullName, effect: 'GRANT' });
    expect(new Date(row.expiresAt).getTime()).toBeGreaterThan(Date.now() + 9 * 86_400_000);
  });
});

describe('requests for access', () => {
  const ask = (who: Ctx, key: string, reason = 'I need it for the term report') => svc.requestAccess(dbOf(who), who, { permissionKey: key, page: '/finance/reports', reason });

  it('any signed-in person asks, naming the permission, the page and why; the right people are told', async () => {
    const teacher = await userWithRoles(prisma, A, ['TEACHER'], 'ask1');
    const ctx = await actorOf(prisma, teacher.id);
    const r = await ask(ctx, 'system.audit.view');
    expect(await prisma.accessRequest.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ userId: teacher.id, permissionKey: 'system.audit.view', page: '/finance/reports', status: 'PENDING' });
    expect((await audit('ACCESS_REQUESTED', r.id)).length).toBe(1);
    const told = (await prisma.notification.findMany({ where: { type: 'ACCESS_REQUEST', dedupeKey: `request:${r.id}` } })).map((n) => n.userId);
    expect(told).toContain(A.users.ADMIN.id);
    expect(told).toContain(A.users.DIRECTOR.id);
    // A request about money goes to the Owner only.
    const money = await ask(ctx, 'finance.reports.view');
    const moneyTold = (await prisma.notification.findMany({ where: { type: 'ACCESS_REQUEST', dedupeKey: `request:${money.id}` } })).map((n) => n.userId);
    expect(moneyTold).toContain(A.users.DIRECTOR.id);
    expect(moneyTold).not.toContain(A.users.ADMIN.id);
  });

  it('refuses a permission already held, a second open request, a made-up key and no reason', async () => {
    const teacher = await userWithRoles(prisma, A, ['TEACHER'], 'ask2');
    const ctx = await actorOf(prisma, teacher.id);
    await fails(ask(ctx, 'exams.marks.enter'), 409, /already have/);
    await ask(ctx, 'system.audit.view');
    await fails(ask(ctx, 'system.audit.view'), 409, /already asked/);
    await fails(ask(ctx, 'made.up.key'), 422);
    await fails(svc.requestAccess(dbOf(ctx), ctx, { permissionKey: 'system.audit.export', page: '', reason: ' ' }), 422);
  });

  it('the Administrator approves an ordinary request as a time-limited exception', async () => {
    const teacher = await userWithRoles(prisma, A, ['TEACHER'], 'ask3');
    const ctx = await actorOf(prisma, teacher.id);
    const r = await ask(ctx, 'system.audit.view');
    const done = await svc.decideRequest(dbOf(admin), admin, r.id, { decision: 'APPROVE', days: 14 });
    expect(done.status).toBe('APPROVED');
    const req = await prisma.accessRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(req).toMatchObject({ status: 'APPROVED', decidedById: admin.id });
    const ov = await prisma.userPermissionOverride.findUniqueOrThrow({ where: { id: req.resultingOverrideId! } });
    expect(ov).toMatchObject({ userId: teacher.id, permissionKey: 'system.audit.view', effect: 'GRANT', createdById: admin.id });
    expect(Math.round((ov.expiresAt.getTime() - ov.createdAt.getTime()) / 86_400_000)).toBe(14);
    expect((await actorOf(prisma, teacher.id)).grants).toContain('system.audit.view');
    expect((await audit('ACCESS_REQUEST_DECIDED', r.id)).pop()!.after).toMatchObject({ status: 'APPROVED', overrideId: ov.id });
    await fails(svc.decideRequest(dbOf(admin), admin, r.id, { decision: 'APPROVE' }), 409, /already been decided/);
  });

  it('a request about money or staff pay is the Owner\'s to decide', async () => {
    const teacher = await userWithRoles(prisma, A, ['TEACHER'], 'ask4');
    const ctx = await actorOf(prisma, teacher.id);
    const r = await ask(ctx, 'finance.reports.view');
    await fails(svc.decideRequest(dbOf(admin), admin, r.id, { decision: 'APPROVE' }), 403, /Owner only/);
    await fails(svc.decideRequest(dbOf(admin), admin, r.id, { decision: 'DECLINE', reason: 'Not for me to say' }), 403);
    await svc.decideRequest(dbOf(owner), owner, r.id, { decision: 'APPROVE', days: 7 });
    expect((await actorOf(prisma, teacher.id)).grants).toContain('finance.reports.view');
  });

  it('a decline needs a reason and tells the person; nobody decides their own request', async () => {
    const teacher = await userWithRoles(prisma, A, ['TEACHER'], 'ask5');
    const ctx = await actorOf(prisma, teacher.id);
    const r = await ask(ctx, 'system.audit.export');
    await fails(svc.decideRequest(dbOf(admin), admin, r.id, { decision: 'DECLINE', reason: '' } as never), 422);
    await svc.decideRequest(dbOf(admin), admin, r.id, { decision: 'DECLINE', reason: 'Ask the Head for the printout instead' });
    expect(await prisma.accessRequest.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: 'DECLINED', decisionNote: 'Ask the Head for the printout instead', resultingOverrideId: null });
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: teacher.id, type: 'ACCESS_REQUEST' } })).title).toMatch(/declined/);
    // After a decline the person may ask again.
    await ask(ctx, 'system.audit.export');

    const mine = await ask(limited, 'system.audit.export');
    await fails(svc.decideRequest(dbOf(limited), limited, mine.id, { decision: 'DECLINE', reason: 'No way, thanks' }), 403, /asked for this yourself/);
  });

  it('lists the queue, newest first, with who decided what', async () => {
    const pending = await svc.listRequests(dbOf(admin), { status: 'PENDING' });
    expect(pending.every((r) => r.status === 'PENDING')).toBe(true);
    const all = await svc.listRequests(dbOf(admin));
    expect(all.find((r) => r.status === 'DECLINED')).toMatchObject({ decidedBy: admin.fullName, ownerOnly: false });
    expect(all.find((r) => r.permissionKey === 'finance.reports.view')!.ownerOnly).toBe(true);
  });
});

describe('what can this user do?', () => {
  it('shows the roles with their places, the exceptions, the permissions by module and where each comes from', async () => {
    const person = await userWithRoles(prisma, A, [], 'view');
    await svc.assignRole(dbOf(admin), admin, person.id, { roleKey: 'HOD', scopeType: 'DEPARTMENT', scopeId: W.dept.sciences });
    await svc.assignRole(dbOf(admin), admin, person.id, { roleKey: 'TEACHER' });
    await svc.createOverride(dbOf(admin), admin, person.id, { permissionKey: 'hr.leave.view_all', effect: 'GRANT', reason: 'Cover', days: 5 });
    const v = await svc.describeAccess(dbOf(admin), person.id);
    expect(v.user.id).toBe(person.id);
    expect(v.roles.find((r) => r.key === 'HOD')).toMatchObject({ scopeType: 'DEPARTMENT', place: 'Sciences', isSystem: true });
    expect(v.overrides[0]).toMatchObject({ permissionKey: 'hr.leave.view_all', state: 'ACTIVE' });
    const exams = v.effective.find((m) => m.module === 'exams')!.keys;
    expect(exams.find((k) => k.key === 'exams.marks.verify')).toMatchObject({ scopes: ['DEPARTMENT'], via: ['Head of Department'] });
    expect(exams.find((k) => k.key === 'exams.marks.enter')).toMatchObject({ scopes: ['ASSIGNED'] });
    expect(v.effective.find((m) => m.module === 'hr')!.keys.find((k) => k.key === 'hr.leave.view_all')!.via).toEqual(['Exception']);
    expect(v.effective.flatMap((m) => m.keys).some((k) => k.key === 'finance.reports.view')).toBe(false);
    expect(v.everything).toBe(false);
    expect((await svc.describeAccess(dbOf(admin), A.users.DIRECTOR.id)).everything).toBe(false); // nobody holds "*"
    expect((await svc.describeAccess(dbOf(admin), A.users.DIRECTOR.id)).effective.length).toBeGreaterThan(5);
    await fails(svc.describeAccess(dbOf(admin), 'nobody'), 404);
    await fails(svc.describeAccess(dbOf(admin), (await userWithRoles(prisma, B, [], 'o')).id), 404);
  });

  it('lists the person\'s recent refused attempts on protected data', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'refused');
    const ctx = await actorOf(prisma, person.id);
    const engine = await import('@/lib/access/check');
    await engine.assertAllowed(ctx, 'students.medical.view').catch(() => undefined);
    await engine.assertAllowed(ctx, 'hr.pay.view').catch(() => undefined);
    const v = await svc.describeAccess(dbOf(admin), person.id);
    expect(v.denied.map((d) => d.key)).toEqual(['hr.pay.view', 'students.medical.view']);
    expect(v.denied[0]!.at).toMatch(/^\d{4}-/);
  });
});

describe('the weekly summary', () => {
  it('tells the Owner how many exceptions are in force, how many end this week and what waits, once a week', async () => {
    const { runScheduledNotifications } = await import('@/lib/system/scheduled');
    const monday = new Date(Date.now() + 1000);
    const first = await runScheduledNotifications(monday);
    expect(first.accessSummaries).toBeGreaterThan(0);
    const notes = await prisma.notification.findMany({ where: { schoolId: A.schoolId, type: 'ACCESS_SUMMARY' } });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.userId === A.users.DIRECTOR.id)).toBe(true);
    expect(notes[0]!.body).toMatch(/\d+ exceptions? in force \(\d+ ending this week\), \d+ requests? waiting/);
    expect((await runScheduledNotifications(monday)).accessSummaries).toBe(0);
    expect(await prisma.notification.count({ where: { schoolId: B.schoolId, type: 'ACCESS_SUMMARY' } })).toBe(0);
  });
});

describe('the routes', () => {
  it('need system.users.edit to copy a role, give a role or make an exception, and 401 without a session', async () => {
    expect((await call('system/roles', 'POST', { as: null, body: {} })).status).toBe(401);
    const plain = await userWithRoles(prisma, A, ['TEACHER'], 'route');
    expect((await call('system/roles', 'POST', { as: plain, body: { fromKey: 'TEACHER', name: 'Nope' } })).status).toBe(403);
    expect((await call('system/users/[id]/roles', 'POST', { as: plain, params: { id: plain.id }, body: { roleKey: 'TEACHER' } })).status).toBe(403);
    expect((await call('system/users/[id]/overrides', 'POST', { as: plain, params: { id: plain.id }, body: {} })).status).toBe(403);
    expect((await call('system/access-requests', 'GET', { as: plain })).status).toBe(403);
    expect((await call('system/exceptions', 'GET', { as: plain })).status).toBe(403);
  });

  it('copy, change and delete a custom role through the API as the Administrator', async () => {
    const made = await call('system/roles', 'POST', { as: A.users.ADMIN, body: { fromKey: 'LIBRARIAN', name: 'Library Assistant' } });
    expect(made.status).toBe(201);
    const key = made.json.data.key as string;
    expect((await call('system/roles/[key]', 'PATCH', { as: A.users.ADMIN, params: { key }, body: { name: 'Library Aide' } })).status).toBe(200);
    expect((await call('system/roles/[key]', 'PATCH', { as: A.users.ADMIN, params: { key: 'LIBRARIAN' }, body: { name: 'x y' } })).status).toBe(403);
    expect((await call('system/roles/[key]', 'DELETE', { as: A.users.ADMIN, params: { key } })).status).toBe(200);
  });

  it('gives a role with a place, shows what the person can do, and answers 422 for a bad exception', async () => {
    const person = await userWithRoles(prisma, A, [], 'route2');
    const r = await call('system/users/[id]/roles', 'POST', { as: A.users.ADMIN, params: { id: person.id }, body: { roleKey: 'HOD', scopeType: 'DEPARTMENT', scopeId: W.dept.humanities } });
    expect(r.status).toBe(201);
    const view = await call('system/users/[id]/access', 'GET', { as: A.users.ADMIN, params: { id: person.id } });
    expect(view.json.data.roles[0]).toMatchObject({ key: 'HOD', place: 'Humanities' });
    const bad = await call('system/users/[id]/overrides', 'POST', { as: A.users.ADMIN, params: { id: person.id }, body: { permissionKey: 'hr.leave.view_all', effect: 'GRANT', reason: 'x', days: 200 } });
    expect(bad.status).toBe(422);
    const ok = await call('system/users/[id]/overrides', 'POST', { as: A.users.ADMIN, params: { id: person.id }, body: { permissionKey: 'hr.leave.view_all', effect: 'GRANT', reason: 'Cover for leave', days: 5 } });
    expect(ok.status).toBe(201);
    expect((await call('system/overrides/[id]', 'DELETE', { as: A.users.ADMIN, params: { id: ok.json.data.id } })).status).toBe(200);
    expect((await call('system/users/[id]/roles/[roleRowId]', 'DELETE', { as: A.users.ADMIN, params: { id: person.id, roleRowId: r.json.data.id } })).status).toBe(200);
  });

  it('asks for access as a signed-in person and decides through the queue', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'route3');
    const asked = await call('system/access-requests', 'POST', { as: person, body: { permissionKey: 'system.audit.view', page: '/system/audit-log', reason: 'To check a login problem' } });
    expect(asked.status).toBe(201);
    const queue = await call('system/access-requests', 'GET', { as: A.users.ADMIN, query: '?status=PENDING' });
    expect(queue.json.data.requests.map((x: { id: string }) => x.id)).toContain(asked.json.data.id);
    expect((await call('system/access-requests/[id]', 'POST', { as: A.users.ADMIN, params: { id: asked.json.data.id }, body: { decision: 'DECLINE', reason: '' } })).status).toBe(422);
    const done = await call('system/access-requests/[id]', 'POST', { as: A.users.ADMIN, params: { id: asked.json.data.id }, body: { decision: 'APPROVE', days: 7 } });
    expect(done.status).toBe(200);
    expect(done.json.data.status).toBe('APPROVED');
    // another school's request is not found
    expect((await call('system/access-requests/[id]', 'POST', { as: B.users.ADMIN, params: { id: asked.json.data.id }, body: { decision: 'APPROVE' } })).status).toBe(404);
  });

  it('exports the exceptions report only with the export permission', async () => {
    expect((await call('system/exceptions', 'GET', { as: A.users.ADMIN })).status).toBe(200);
    const csv = await call('system/exceptions', 'GET', { as: A.users.ADMIN, query: '?format=csv&history=1' });
    expect(csv.status).toBe(200);
    expect(csv.text.split('\n')[0]).toContain('Person');
    expect((await call('system/exceptions', 'GET', { as: A.users.TEACHER, query: '?format=csv' })).status).toBe(403);
  });
});

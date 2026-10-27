// User administration for the System module. Routes call these after the permission check; every
// change writes its AuditLog row in the same transaction. Nobody types another person's password:
// a new person gets an invite link (72 hours) to set their own, or a temporary password shown once.
// Users are never deleted, because their name stays on audit records: they are deactivated.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Prisma, Role } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import * as guards from '@/lib/access/guards';
import { logAudit } from '@/lib/audit';
import { generateTempPassword, hashPassword } from '@/lib/password';
import { createResetToken, resetUrl } from '@/lib/password-reset';
import { adminIds, notifyUsers } from '@/lib/system/notifications';
import { accessFor, parseStaffRole, REQUIRED_ROLES, STAFF_ROLE_KEYS, STAFF_ROLE_LABEL, type StaffRoleKey } from '@/lib/staff-roles';
import { parseCsv } from '@/lib/students/csv';
import type { Db, ScopedDb } from '@/lib/scoped-db';
import type { TableQuery } from '@/lib/table-query';
import { SystemCreateUserSchema } from '@/lib/validations/system';

type Actor = { id: string; schoolId: string };

/** The role keys a person holds now (read in the same transaction as the change they make). */
export async function roleKeysOf(tx: Db, userId: string): Promise<string[]> {
  const rows = await tx.userRole.findMany({ where: { userId }, select: { role: { select: { key: true } } } });
  return Array.from(new Set(rows.map((r) => r.role.key)));
}

const symmetric = (a: readonly string[], b: readonly string[]) => [...a.filter((k) => !b.includes(k)), ...b.filter((k) => !a.includes(k))];

export const USER_STATUSES = ['invited', 'active', 'deactivated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_FILTERS = { role: z.enum(STAFF_ROLE_KEYS), status: z.enum(USER_STATUSES) };
export const USER_SORTABLE = ['fullName', 'email', 'lastLoginAt', 'createdAt'] as const;
export const MAX_IMPORT_ROWS = 200;

const USER_SELECT = {
  id: true, fullName: true, email: true, phone: true, title: true, photoUrl: true, role: true,
  active: true, invitePending: true, lastLoginAt: true, createdAt: true,
  userRoles: { select: { role: { select: { key: true } } } },
} as const;
type DbUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

/** A user as the screens use them: the roles as a list of keys, in the order of the role list. */
export type UserRow = Omit<DbUser, 'userRoles'> & { roles: StaffRoleKey[] };

const order = (k: string) => STAFF_ROLE_KEYS.indexOf(k as StaffRoleKey);
function shape(u: DbUser): UserRow {
  const { userRoles, ...rest } = u;
  const roles = Array.from(new Set(userRoles.map((r) => r.role.key as StaffRoleKey))).sort((a, b) => order(a) - order(b));
  return { ...rest, roles };
}

export const statusOf = (u: { active: boolean; invitePending: boolean }): UserStatus => (!u.active ? 'deactivated' : u.invitePending ? 'invited' : 'active');

export function userWhere(q: TableQuery): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = { isSupport: false };
  if (q.q) {
    // A phone is stored as +263771234567, but people search for 0771234567 or 77123.
    const digits = q.q.replace(/\D/g, '');
    const national = digits.replace(/^(?:00)?263/, '').replace(/^0/, '');
    where.OR = [
      { fullName: { contains: q.q, mode: 'insensitive' } },
      { email: { contains: q.q, mode: 'insensitive' } },
      { phone: { contains: q.q } },
      ...(national.length >= 3 ? [{ phone: { contains: national } }] : []),
    ];
  }
  if (q.filters.role) where.userRoles = { some: { role: { key: q.filters.role } } };
  const status = q.filters.status as UserStatus | undefined;
  if (status === 'deactivated') where.active = false;
  if (status === 'invited') Object.assign(where, { active: true, invitePending: true });
  if (status === 'active') Object.assign(where, { active: true, invitePending: false });
  return where;
}

export async function listUsers(db: ScopedDb, q: TableQuery, opts: { all?: boolean } = {}) {
  const where = userWhere(q);
  const dir = q.dir;
  const sort = q.sort ?? 'fullName';
  const orderBy: Prisma.UserOrderByWithRelationInput[] = [
    // People who have never signed in go last whichever way the list is sorted.
    sort === 'lastLoginAt' ? { lastLoginAt: { sort: dir, nulls: 'last' } } : ({ [sort]: dir } as Prisma.UserOrderByWithRelationInput),
    { id: 'asc' },
  ];
  const [total, rows] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({ where, orderBy, select: USER_SELECT, ...(opts.all ? { take: 10_000 } : { skip: (q.page - 1) * q.pageSize, take: q.pageSize }) }),
  ]);
  return { total, rows: rows.map(shape) };
}

/** Counts across the whole school, not the filtered list. */
export async function userCounts(db: ScopedDb) {
  const [active, invited, deactivated] = await Promise.all([
    db.user.count({ where: { isSupport: false, active: true, invitePending: false } }),
    db.user.count({ where: { isSupport: false, active: true, invitePending: true } }),
    db.user.count({ where: { isSupport: false, active: false } }),
  ]);
  return { active, invited, deactivated };
}

// ─── Roles: what must always remain ──────────────────────────────────────────

const rolesDetail = (roles: readonly string[]) => roles.map((r) => STAFF_ROLE_LABEL[r] ?? r).join(', ');

/** Active people who hold a role, leaving one person out. */
async function holders(tx: Db, schoolId: string, key: string, exceptId: string) {
  return tx.user.count({ where: { schoolId, active: true, isSupport: false, id: { not: exceptId }, userRoles: { some: { role: { key } } } } });
}

/**
 * The school must always have an active Owner and an active Administrator. Called with what the
 * person will be after the change. A school that has none yet (an older one) is not blocked from
 * unrelated changes: only taking away the last one is refused.
 */
export async function assertRequiredRolesRemain(tx: Db, schoolId: string, target: { id: string; active: boolean; roles: readonly string[] }, after: { active: boolean; roles: readonly string[] }) {
  for (const key of REQUIRED_ROLES) {
    const had = target.active && target.roles.includes(key);
    const keeps = after.active && after.roles.includes(key);
    if (had && !keeps && (await holders(tx, schoolId, key, target.id)) === 0) {
      throw new ServiceError(`The school must always have at least one active ${STAFF_ROLE_LABEL[key]}`, 409);
    }
  }
}

/**
 * Replaces the person's roles (whole school). A role held for one class or department (class teacher, head of
 * department; set in Academics) is kept while it is still wanted, and is not turned into a school-wide role.
 */
async function setRoles(tx: Db, schoolId: string, userId: string, keys: readonly string[], cache?: Map<string, string>) {
  const scoped = await tx.userRole.findMany({ where: { userId, scopeType: { not: 'SCHOOL' } }, select: { id: true, role: { select: { key: true } } } });
  if (scoped.length) {
    const keep = new Set(keys);
    await tx.userRole.deleteMany({ where: { id: { in: scoped.filter((s) => !keep.has(s.role.key)).map((s) => s.id) } } });
    const scopedKeys = new Set(scoped.filter((s) => keep.has(s.role.key)).map((s) => s.role.key));
    await setSchoolRoles(tx, schoolId, userId, keys.filter((k) => !scopedKeys.has(k)), cache);
    return;
  }
  await setSchoolRoles(tx, schoolId, userId, keys, cache);
}

async function setSchoolRoles(tx: Db, schoolId: string, userId: string, keys: readonly string[], cache?: Map<string, string>) {
  const wanted = Array.from(new Set(keys));
  const missing = wanted.filter((k) => !cache?.has(k));
  if (missing.length) {
    const defs = await tx.roleDefinition.findMany({ where: { schoolId, key: { in: missing } }, select: { id: true, key: true } });
    for (const d of defs) cache?.set(d.key, d.id);
    if (defs.length !== missing.length) throw new ServiceError('One of the roles was not found for this school', 500);
    if (!cache) {
      await tx.userRole.deleteMany({ where: { userId, scopeType: 'SCHOOL' } });
      await tx.userRole.createMany({ data: defs.map((d) => ({ schoolId, userId, roleId: d.id })) });
      return;
    }
  }
  await tx.userRole.deleteMany({ where: { userId, scopeType: 'SCHOOL' } });
  await tx.userRole.createMany({ data: wanted.map((k) => ({ schoolId, userId, roleId: cache!.get(k)! })) });
}

// What the person is told about getting the link to the new user. Sending by e-mail and SMS needs
// a provider; until one is connected the administrator passes the link on (copy, WhatsApp, e-mail).
export const INVITE_DELIVERY = { email: 'not_connected', sms: 'not_connected' } as const;

/** A password that nobody knows, so an invited account cannot be signed into until the link is used. */
const unusablePassword = () => `!invited!${randomBytes(24).toString('hex')}`;

// ─── Create ──────────────────────────────────────────────────────────────────

export interface NewUser {
  fullName: string;
  email: string;
  phone: string;
  roles: StaffRoleKey[];
  title?: string | null;
  signIn: 'INVITE' | 'TEMP_PASSWORD';
}

async function createOne(tx: Db, actor: Actor, input: NewUser, passwordHash: string, now: Date, roleIds?: Map<string, string>) {
  const created = await tx.user.create({
    data: {
      schoolId: actor.schoolId, fullName: input.fullName, email: input.email, phone: input.phone, title: input.title ?? null,
      role: accessFor(input.roles), passwordHash, mustChangePassword: input.signIn === 'TEMP_PASSWORD', invitePending: true, invitedAt: now,
    },
    select: { id: true },
  });
  await setRoles(tx, actor.schoolId, created.id, input.roles, roleIds);
  const user = shape(await tx.user.findUniqueOrThrow({ where: { id: created.id }, select: USER_SELECT }));
  await logAudit(
    {
      schoolId: actor.schoolId, actorId: actor.id, action: 'CREATE_USER', entityType: 'User', entityId: user.id,
      detail: `${user.fullName} (${rolesDetail(input.roles)})`,
      after: { fullName: user.fullName, email: user.email, phone: user.phone, roles: input.roles, signIn: input.signIn },
    },
    tx,
  );
  return user;
}

async function emailTaken(db: Db, email: string, exceptId?: string) {
  return db.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
}

async function tellAdmins(tx: Db, actor: Actor, title: string, body: string) {
  await notifyUsers(tx, actor.schoolId, await adminIds(tx, actor.schoolId, actor.id), { type: 'USERS', title, body, link: '/system/users' });
}

export async function createUser(db: ScopedDb, actor: Actor, input: NewUser) {
  if (await emailTaken(db, input.email)) throw new ServiceError('A user with this email already exists', 409);

  const tempPassword = input.signIn === 'TEMP_PASSWORD' ? generateTempPassword() : null;
  const passwordHash = tempPassword ? await hashPassword(tempPassword) : unusablePassword();
  const now = new Date();

  return db.$tx(async (tx) => {
    guards.protectedRolesNeedOwner({ id: actor.id, roles: await roleKeysOf(tx, actor.id) }, input.roles);
    const user = await createOne(tx, actor, input, passwordHash, now);
    let invite: { url: string; expiresAt: Date } | null = null;
    if (input.signIn === 'INVITE') {
      const t = await createResetToken(tx, actor.schoolId, actor.id, user.id, now, { kind: 'INVITE' });
      invite = { url: resetUrl(t.token, true), expiresAt: t.expiresAt };
      await logAudit({ schoolId: actor.schoolId, actorId: actor.id, action: 'INVITE_USER', entityType: 'User', entityId: user.id, detail: `Invite for ${user.fullName}, valid 72 hours` }, tx);
    }
    await tellAdmins(tx, actor, 'User added', `${user.fullName} was added as ${rolesDetail(input.roles)}.`);
    return { user, tempPassword, invite, delivery: INVITE_DELIVERY };
  });
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateUser(
  db: ScopedDb,
  actor: Actor,
  id: string,
  input: { fullName?: string; email?: string; phone?: string; title?: string | null; roles?: StaffRoleKey[] },
) {
  const found = await db.user.findFirst({ where: { id, isSupport: false }, select: USER_SELECT });
  if (!found) throw new ServiceError('User not found', 404);
  const target = shape(found);

  const sameRoles = input.roles !== undefined && [...input.roles].sort().join() === [...target.roles].sort().join();
  const changingRoles = input.roles !== undefined && !sameRoles;
  // Rule 8: nobody changes their own roles. This also stops a person taking their own Administrator role away and locking the school out.
  if (changingRoles) guards.cannotChangeOwnAccess(actor, id);
  if (input.email !== undefined && input.email.toLowerCase() !== target.email.toLowerCase() && (await emailTaken(db, input.email, id))) {
    throw new ServiceError('A user with this email already exists', 409);
  }

  return db.$tx(async (tx) => {
    if (changingRoles) {
      guards.protectedRolesNeedOwner({ id: actor.id, roles: await roleKeysOf(tx, actor.id) }, symmetric(target.roles, input.roles!));
      await assertRequiredRolesRemain(tx, actor.schoolId, target, { active: target.active, roles: input.roles! });
    }

    await tx.user.update({
      where: { id },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        // A change of roles can change what the person may open, so open sessions are ended.
        ...(changingRoles ? { role: accessFor(input.roles!), tokenVersion: { increment: 1 }, permVersion: { increment: 1 } } : {}),
      },
    });
    if (changingRoles) await setRoles(tx, actor.schoolId, id, input.roles!);

    const updated = shape(await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT }));
    const detailsChanged = (['fullName', 'email', 'phone', 'title'] as const).some((k) => target[k] !== updated[k]);
    if (detailsChanged || !changingRoles) {
      await logAudit(
        {
          schoolId: actor.schoolId, actorId: actor.id, action: 'UPDATE_USER', entityType: 'User', entityId: id,
          detail: `${updated.fullName}: details changed`,
          before: { fullName: target.fullName, email: target.email, phone: target.phone, title: target.title },
          after: { fullName: updated.fullName, email: updated.email, phone: updated.phone, title: updated.title },
        },
        tx,
      );
    }
    if (changingRoles) {
      await logAudit(
        {
          schoolId: actor.schoolId, actorId: actor.id, action: 'ROLES_CHANGED', entityType: 'User', entityId: id,
          detail: `${updated.fullName}: ${rolesDetail(target.roles)} → ${rolesDetail(updated.roles)}`,
          before: { roles: target.roles }, after: { roles: updated.roles },
        },
        tx,
      );
    }
    if (changingRoles) {
      await notifyUsers(tx, actor.schoolId, [id], { type: 'ROLES_CHANGED', title: 'Your roles changed', body: `You are now ${rolesDetail(updated.roles)}.`, link: '/system/profile' });
      await tellAdmins(tx, actor, 'Roles changed', `${updated.fullName} is now ${rolesDetail(updated.roles)}.`);
    }
    return updated;
  });
}

// ─── Invite again, deactivate, reset password ───────────────────────────────

/** A new 72-hour link for someone who has not set a password yet. The earlier link stops working. */
export async function resendInvite(db: ScopedDb, actor: Actor, id: string) {
  const found = await db.user.findFirst({ where: { id, isSupport: false }, select: USER_SELECT });
  if (!found) throw new ServiceError('User not found', 404);
  const target = shape(found);
  if (!target.active) throw new ServiceError('This account is deactivated. Reactivate it first.', 409);
  if (!target.invitePending) throw new ServiceError(`${target.fullName} has already set up their account`, 409);

  return db.$tx(async (tx) => {
    const t = await createResetToken(tx, actor.schoolId, actor.id, id, new Date(), { kind: 'INVITE' });
    await tx.user.update({ where: { id }, data: { invitedAt: new Date() } });
    await logAudit({ schoolId: actor.schoolId, actorId: actor.id, action: 'INVITE_USER', entityType: 'User', entityId: id, detail: `New invite for ${target.fullName}, valid 72 hours` }, tx);
    return { user: target, invite: { url: resetUrl(t.token, true), expiresAt: t.expiresAt }, delivery: INVITE_DELIVERY };
  });
}

export async function setUserActive(db: ScopedDb, actor: Actor, id: string, active: boolean) {
  const found = await db.user.findFirst({ where: { id, isSupport: false }, select: USER_SELECT });
  if (!found) throw new ServiceError('User not found', 404);
  const target = shape(found);
  if (target.id === actor.id) throw new ServiceError('You cannot deactivate your own account', 409);
  if (target.active === active) throw new ServiceError(active ? 'This user is already active' : 'This user is already deactivated', 409);

  return db.$tx(async (tx) => {
    if (!active) await assertRequiredRolesRemain(tx, actor.schoolId, target, { active: false, roles: target.roles });
    await tx.user.update({
      where: { id },
      // Deactivating ends the person's sessions at once: every open session carries the old tokenVersion.
      data: { active, permVersion: { increment: 1 }, ...(active ? {} : { tokenVersion: { increment: 1 } }) },
    });
    const updated = shape(await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT }));
    await logAudit(
      {
        schoolId: actor.schoolId, actorId: actor.id, action: active ? 'REACTIVATE_USER' : 'DEACTIVATE_USER',
        entityType: 'User', entityId: id, detail: `${updated.fullName} (${rolesDetail(updated.roles)})`,
        before: { active: target.active }, after: { active },
      },
      tx,
    );
    await tellAdmins(tx, actor, active ? 'User reactivated' : 'User deactivated', updated.fullName);
    return updated;
  });
}

/** A reset link (30 minutes, one use) for an active person. It is handed over, like an invite. */
export async function createResetLink(db: ScopedDb, actor: Actor, id: string) {
  const target = await db.user.findFirst({ where: { id, isSupport: false }, select: { id: true, active: true, fullName: true } });
  if (!target) throw new ServiceError('User not found', 404);
  if (!target.active) throw new ServiceError('This account is deactivated. Reactivate it first.', 409);
  const { token, expiresAt } = await db.$tx((tx) => createResetToken(tx, actor.schoolId, actor.id, id));
  return { url: resetUrl(token), expiresAt, user: target };
}

export async function resetUserPassword(db: ScopedDb, actor: Actor, id: string) {
  const target = await db.user.findFirst({ where: { id, isSupport: false }, select: { id: true, active: true, fullName: true } });
  if (!target) throw new ServiceError('User not found', 404);
  if (!target.active) throw new ServiceError('This account is deactivated. Reactivate it first.', 409);

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await db.$tx(async (tx) => {
    // tokenVersion ends every session opened with the old password.
    await tx.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true, tokenVersion: { increment: 1 } } });
    await logAudit({ schoolId: actor.schoolId, actorId: actor.id, action: 'RESET_PASSWORD', entityType: 'User', entityId: id, detail: target.fullName }, tx);
  });
  return { tempPassword };
}

// ─── Import from CSV ─────────────────────────────────────────────────────────

export const IMPORT_TEMPLATE = 'name,email,phone,roles\r\nTendai Moyo,tendai@school.co.zw,0771234567,Teacher;Class Teacher\r\nRudo Chari,rudo@school.co.zw,0712345678,Bursar\r\n';

export interface RejectedUserRow { row: number; name: string; email: string; phone: string; roles: string; reason: string }

const HEADERS: Record<'name' | 'email' | 'phone' | 'roles' | 'title', string[]> = {
  name: ['name', 'full name', 'fullname', 'full_name'],
  email: ['email', 'e-mail', 'email address'],
  phone: ['phone', 'mobile', 'cell', 'cellphone', 'phone number', 'mobile number'],
  roles: ['roles', 'role'],
  title: ['title'],
};

export async function importUsers(db: ScopedDb, actor: Actor, csv: string) {
  const table = parseCsv(csv);
  if (table.length < 2) throw new ServiceError('The file needs a header row (name, email, phone, roles) and at least one person', 422);

  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (k: keyof typeof HEADERS) => header.findIndex((h) => HEADERS[k].includes(h));
  const index = { name: col('name'), email: col('email'), phone: col('phone'), roles: col('roles'), title: col('title') };
  const missing = (['name', 'email', 'phone', 'roles'] as const).filter((k) => index[k] < 0);
  if (missing.length) throw new ServiceError(`The first row must have these columns: name, email, phone, roles (missing: ${missing.join(', ')})`, 422);
  const body = table.slice(1);
  if (body.length > MAX_IMPORT_ROWS) throw new ServiceError(`At most ${MAX_IMPORT_ROWS} people at a time (the file has ${body.length})`, 422);

  const existing = new Set((await db.user.findMany({ select: { email: true } })).map((u) => u.email.toLowerCase()));
  const seen = new Map<string, number>();
  const rejected: RejectedUserRow[] = [];
  const valid: { row: number; input: NewUser }[] = [];

  body.forEach((fields, i) => {
    const row = i + 2; // the line in the spreadsheet, counting the header as line 1
    const get = (k: keyof typeof index) => (index[k] >= 0 ? (fields[index[k]] ?? '').trim() : '');
    const raw = { name: get('name'), email: get('email'), phone: get('phone'), roles: get('roles') };
    const reject = (reason: string) => rejected.push({ row, ...raw, reason });

    const roleNames = raw.roles.split(/[;|,]/).map((r) => r.trim()).filter(Boolean);
    const roles: StaffRoleKey[] = [];
    for (const name of roleNames) {
      const key = parseStaffRole(name);
      if (!key) return reject(`Unknown role "${name}"`);
      roles.push(key);
    }
    const parsed = SystemCreateUserSchema.safeParse({ fullName: raw.name, email: raw.email, phone: raw.phone, roles, title: get('title'), signIn: 'INVITE' });
    if (!parsed.success) return reject(parsed.error.issues[0]?.message ?? 'Not valid');
    const email = parsed.data.email.toLowerCase();
    if (existing.has(email)) return reject('This email is already used by a user');
    const first = seen.get(email);
    if (first) return reject(`This email is repeated (first on row ${first})`);
    seen.set(email, row);
    valid.push({ row, input: { ...parsed.data, signIn: 'INVITE' } });
  });

  if (valid.length === 0) return { created: 0, rejected, invites: [] as { fullName: string; email: string; phone: string; url: string }[], expiresAt: null as Date | null };

  const now = new Date();
  const result = await db.$tx(async (tx) => {
    const invites: { fullName: string; email: string; phone: string; url: string }[] = [];
    let expiresAt = now;
    const roleIds = new Map<string, string>();
    guards.protectedRolesNeedOwner({ id: actor.id, roles: await roleKeysOf(tx, actor.id) }, valid.flatMap((v) => v.input.roles));
    for (const v of valid) {
      const user = await createOne(tx, actor, v.input, unusablePassword(), now, roleIds);
      const t = await createResetToken(tx, actor.schoolId, actor.id, user.id, now, { kind: 'INVITE' });
      expiresAt = t.expiresAt;
      invites.push({ fullName: user.fullName, email: user.email, phone: user.phone ?? '', url: resetUrl(t.token, true) });
    }
    await logAudit(
      {
        schoolId: actor.schoolId, actorId: actor.id, action: 'IMPORT_USERS', entityType: 'User', entityId: actor.schoolId,
        detail: `Imported ${valid.length} user${valid.length === 1 ? '' : 's'} from a file; ${rejected.length} row${rejected.length === 1 ? '' : 's'} rejected`,
      },
      tx,
    );
    await tellAdmins(tx, actor, 'Users imported', `${valid.length} added from a file.`);
    return { invites, expiresAt };
  }, { timeout: 120_000, maxWait: 10_000 });
  return { created: valid.length, rejected, invites: result.invites, expiresAt: result.expiresAt as Date | null };
}

export type { Role };

// User administration for the System module. Routes call these after the permission check; every
// change writes its AuditLog row in the same transaction. Nobody types another person's password:
// a new person gets an invite link (72 hours) to set their own, or a temporary password shown once.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Prisma, Role, StaffRole } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { generateTempPassword, hashPassword } from '@/lib/password';
import { FULL_ACCESS_ROLES } from '@/lib/access-core';
import { createResetToken, resetUrl } from '@/lib/password-reset';
import { notifyAdmins } from '@/lib/system/notifications';
import { accessFor, parseStaffRole, STAFF_ROLE_KEYS, STAFF_ROLE_LABEL } from '@/lib/staff-roles';
import { normalizeZimMobile } from '@/lib/students/registration';
import { parseCsv } from '@/lib/students/csv';
import type { Db, ScopedDb } from '@/lib/scoped-db';
import type { TableQuery } from '@/lib/table-query';
import { SystemCreateUserSchema } from '@/lib/validations/system';

type Actor = { id: string; schoolId: string };

export const USER_STATUSES = ['invited', 'active', 'deactivated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_FILTERS = { role: z.enum(STAFF_ROLE_KEYS), status: z.enum(USER_STATUSES) };
export const USER_SORTABLE = ['fullName', 'email', 'lastLoginAt', 'createdAt'] as const;
export const MAX_IMPORT_ROWS = 200;

const USER_SELECT = {
  id: true, fullName: true, email: true, phone: true, title: true, staffRoles: true, role: true,
  active: true, invitePending: true, lastLoginAt: true, createdAt: true,
} as const;
export type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export const statusOf = (u: { active: boolean; invitePending: boolean }): UserStatus => (!u.active ? 'deactivated' : u.invitePending ? 'invited' : 'active');

export function userWhere(q: TableQuery): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};
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
  if (q.filters.role) where.staffRoles = { has: q.filters.role as StaffRole };
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
  return { total, rows };
}

/** Counts across the whole school, not the filtered list. */
export async function userCounts(db: ScopedDb) {
  const [active, invited, deactivated] = await Promise.all([
    db.user.count({ where: { active: true, invitePending: false } }),
    db.user.count({ where: { active: true, invitePending: true } }),
    db.user.count({ where: { active: false } }),
  ]);
  return { active, invited, deactivated };
}

async function otherActiveAdmins(tx: Db, exceptId: string) {
  return tx.user.count({ where: { active: true, id: { not: exceptId }, role: { in: FULL_ACCESS_ROLES as unknown as Role[] } } });
}

const isFull = (role: string) => (FULL_ACCESS_ROLES as readonly string[]).includes(role);

// What the person is told about getting the link to the new user. Sending by e-mail and SMS needs
// a provider; until one is connected the administrator passes the link on (copy, WhatsApp, e-mail).
export const INVITE_DELIVERY = { email: 'not_connected', sms: 'not_connected' } as const;

/** A password that nobody knows, so an invited account cannot be signed into until the link is used. */
const unusablePassword = () => `!invited!${randomBytes(24).toString('hex')}`;

const rolesDetail = (roles: readonly string[]) => roles.map((r) => STAFF_ROLE_LABEL[r] ?? r).join(', ');

// ─── Create ──────────────────────────────────────────────────────────────────

export interface NewUser {
  fullName: string;
  email: string;
  phone: string;
  roles: StaffRole[];
  title?: string | null;
  signIn: 'INVITE' | 'TEMP_PASSWORD';
}

async function createOne(tx: Db, actor: Actor, input: NewUser, passwordHash: string, now: Date) {
  const created = await tx.user.create({
    data: {
      schoolId: actor.schoolId, fullName: input.fullName, email: input.email, phone: input.phone, title: input.title ?? null,
      staffRoles: input.roles, role: accessFor(input.roles), passwordHash,
      mustChangePassword: input.signIn === 'TEMP_PASSWORD', invitePending: true, invitedAt: now,
    },
    select: USER_SELECT,
  });
  await logAudit(
    {
      schoolId: actor.schoolId, actorId: actor.id, action: 'CREATE_USER', entityType: 'User', entityId: created.id,
      detail: `${created.fullName} (${rolesDetail(input.roles)})`,
      after: { fullName: created.fullName, email: created.email, phone: created.phone, roles: input.roles, signIn: input.signIn },
    },
    tx,
  );
  return created;
}

async function emailTaken(db: Db, email: string, exceptId?: string) {
  return db.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
}

export async function createUser(db: ScopedDb, actor: Actor, input: NewUser) {
  if (await emailTaken(db, input.email)) throw new ServiceError('A user with this email already exists', 409);

  const tempPassword = input.signIn === 'TEMP_PASSWORD' ? generateTempPassword() : null;
  const passwordHash = tempPassword ? await hashPassword(tempPassword) : unusablePassword();
  const now = new Date();

  return db.$tx(async (tx) => {
    const user = await createOne(tx, actor, input, passwordHash, now);
    let invite: { url: string; expiresAt: Date } | null = null;
    if (input.signIn === 'INVITE') {
      const t = await createResetToken(tx, actor.schoolId, actor.id, user.id, now, { kind: 'INVITE' });
      invite = { url: resetUrl(t.token, true), expiresAt: t.expiresAt };
      await logAudit({ schoolId: actor.schoolId, actorId: actor.id, action: 'INVITE_USER', entityType: 'User', entityId: user.id, detail: `Invite for ${user.fullName}, valid 72 hours` }, tx);
    }
    await notifyAdmins(tx, actor.schoolId, actor.id, { title: 'User added', body: `${user.fullName} was added as ${rolesDetail(input.roles)}.`, href: '/system/users' });
    return { user, tempPassword, invite, delivery: INVITE_DELIVERY };
  });
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateUser(
  db: ScopedDb,
  actor: Actor,
  id: string,
  input: { fullName?: string; email?: string; phone?: string; title?: string | null; roles?: StaffRole[] },
) {
  const target = await db.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!target) throw new ServiceError('User not found', 404);

  const sameRoles = input.roles !== undefined && [...input.roles].sort().join() === [...target.staffRoles].sort().join();
  const changingRoles = input.roles !== undefined && !sameRoles;
  if (target.id === actor.id && changingRoles) throw new ServiceError('You cannot change your own roles', 409);

  if (input.email !== undefined && input.email.toLowerCase() !== target.email.toLowerCase() && (await emailTaken(db, input.email, id))) {
    throw new ServiceError('A user with this email already exists', 409);
  }

  const newAccess = changingRoles ? accessFor(input.roles!) : target.role;

  return db.$tx(async (tx) => {
    if (changingRoles && isFull(target.role) && target.active && !isFull(newAccess) && (await otherActiveAdmins(tx, id)) === 0) {
      throw new ServiceError('The school needs at least one active administrator', 409);
    }
    const updated = await tx.user.update({
      where: { id },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        // A change of roles can change what the person may open, so open sessions are ended.
        ...(changingRoles ? { staffRoles: input.roles, role: newAccess, tokenVersion: { increment: 1 } } : {}),
      },
      select: USER_SELECT,
    });
    await logAudit(
      {
        schoolId: actor.schoolId, actorId: actor.id, action: 'UPDATE_USER', entityType: 'User', entityId: id,
        detail: changingRoles ? `Roles: ${rolesDetail(target.staffRoles)} → ${rolesDetail(updated.staffRoles)}` : 'Details changed',
        before: { fullName: target.fullName, email: target.email, phone: target.phone, title: target.title, roles: target.staffRoles },
        after: { fullName: updated.fullName, email: updated.email, phone: updated.phone, title: updated.title, roles: updated.staffRoles },
      },
      tx,
    );
    if (changingRoles) {
      await notifyAdmins(tx, actor.schoolId, actor.id, { title: 'Roles changed', body: `${updated.fullName} is now ${rolesDetail(updated.staffRoles)}.`, href: '/system/users' });
    }
    return updated;
  });
}

// ─── Invite again, deactivate, reset password ───────────────────────────────

/** A new 72-hour link for someone who has not set a password yet. The earlier link stops working. */
export async function resendInvite(db: ScopedDb, actor: Actor, id: string) {
  const target = await db.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!target) throw new ServiceError('User not found', 404);
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
  const target = await db.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!target) throw new ServiceError('User not found', 404);
  if (target.id === actor.id) throw new ServiceError('You cannot deactivate your own account', 409);
  if (target.active === active) throw new ServiceError(active ? 'This user is already active' : 'This user is already deactivated', 409);

  return db.$tx(async (tx) => {
    if (!active && isFull(target.role) && (await otherActiveAdmins(tx, id)) === 0) {
      throw new ServiceError('The school needs at least one active administrator', 409);
    }
    const updated = await tx.user.update({
      where: { id },
      // Deactivating ends any open session at its next check.
      data: { active, ...(active ? {} : { tokenVersion: { increment: 1 } }) },
      select: USER_SELECT,
    });
    await logAudit(
      {
        schoolId: actor.schoolId, actorId: actor.id, action: active ? 'REACTIVATE_USER' : 'DEACTIVATE_USER',
        entityType: 'User', entityId: id, detail: `${updated.fullName} (${rolesDetail(updated.staffRoles)})`,
        before: { active: target.active }, after: { active },
      },
      tx,
    );
    await notifyAdmins(tx, actor.schoolId, actor.id, { title: active ? 'User reactivated' : 'User deactivated', body: updated.fullName, href: '/system/users' });
    return updated;
  });
}

export async function resetUserPassword(db: ScopedDb, actor: Actor, id: string) {
  const target = await db.user.findUnique({ where: { id }, select: USER_SELECT });
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
    const roles: StaffRole[] = [];
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
    for (const v of valid) {
      const user = await createOne(tx, actor, v.input, unusablePassword(), now);
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
    await notifyAdmins(tx, actor.schoolId, actor.id, { title: 'Users imported', body: `${valid.length} added from a file.`, href: '/system/users' });
    return { invites, expiresAt };
  });
  return { created: valid.length, rejected, invites: result.invites, expiresAt: result.expiresAt as Date | null };
}

export { normalizeZimMobile };

// User administration for the System module. Routes call these after the
// permission check; every change writes its AuditLog row in the same transaction.
import { z } from 'zod';
import type { Prisma, Role } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { generateTempPassword, hashPassword } from '@/lib/password';
import { FULL_ACCESS_ROLES } from '@/lib/access-core';
import { notifyAdmins } from '@/lib/system/notifications';
import type { Db, ScopedDb } from '@/lib/scoped-db';
import type { TableQuery } from '@/lib/table-query';
import { ROLES } from '@/lib/validations/system';

export const USER_FILTERS = { role: z.enum(ROLES), status: z.enum(['active', 'inactive']) };
export const USER_SORTABLE = ['fullName', 'email', 'role', 'active', 'createdAt'] as const;

const USER_SELECT = { id: true, fullName: true, email: true, role: true, active: true, createdAt: true } as const;
export type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export function userWhere(q: TableQuery): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};
  if (q.q) where.OR = [{ fullName: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }];
  if (q.filters.role) where.role = q.filters.role as Role;
  if (q.filters.status) where.active = q.filters.status === 'active';
  return where;
}

export async function listUsers(db: ScopedDb, q: TableQuery, opts: { all?: boolean } = {}) {
  const where = userWhere(q);
  const orderBy: Prisma.UserOrderByWithRelationInput[] = [
    { [q.sort ?? 'fullName']: q.dir } as Prisma.UserOrderByWithRelationInput,
    { id: 'asc' },
  ];
  const [total, rows] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy,
      select: USER_SELECT,
      ...(opts.all ? { take: 10_000 } : { skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    }),
  ]);
  return { total, rows };
}

async function otherActiveAdmins(tx: Db, exceptId: string) {
  return tx.user.count({ where: { active: true, id: { not: exceptId }, role: { in: FULL_ACCESS_ROLES as unknown as Role[] } } });
}

export async function createUser(
  db: ScopedDb,
  actor: { id: string; schoolId: string },
  input: { fullName: string; email: string; role: Role },
) {
  const clash = await db.user.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' } }, select: { id: true } });
  if (clash) throw new ServiceError('A user with this email already exists', 409);

  // Shown to the administrator once; the new user must replace it at first sign-in.
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const user = await db.$tx(async (tx) => {
    const created = await tx.user.create({
      data: { schoolId: actor.schoolId, ...input, passwordHash, mustChangePassword: true },
      select: USER_SELECT,
    });
    await logAudit(
      {
        schoolId: actor.schoolId, actorId: actor.id, action: 'CREATE_USER', entityType: 'User', entityId: created.id,
        detail: `${created.fullName} (${created.role})`,
        after: { fullName: created.fullName, email: created.email, role: created.role },
      },
      tx,
    );
    await notifyAdmins(tx, actor.schoolId, actor.id, { title: 'User added', body: `${created.fullName} was added as ${created.role}.`, href: '/system/users' });
    return created;
  });
  return { user, tempPassword };
}

export async function updateUser(
  db: ScopedDb,
  actor: { id: string; schoolId: string },
  id: string,
  input: { fullName?: string; email?: string; role?: Role },
) {
  const target = await db.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!target) throw new ServiceError('User not found', 404);

  const changingRole = input.role !== undefined && input.role !== target.role;
  if (target.id === actor.id && changingRole) throw new ServiceError('You cannot change your own role', 409);

  if (input.email !== undefined && input.email.toLowerCase() !== target.email.toLowerCase()) {
    const clash = await db.user.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' }, id: { not: id } }, select: { id: true } });
    if (clash) throw new ServiceError('A user with this email already exists', 409);
  }

  return db.$tx(async (tx) => {
    if (changingRole && (FULL_ACCESS_ROLES as readonly string[]).includes(target.role) && target.active) {
      if ((await otherActiveAdmins(tx, id)) === 0 && !(FULL_ACCESS_ROLES as readonly string[]).includes(input.role!)) {
        throw new ServiceError('The school needs at least one active administrator', 409);
      }
    }
    const updated = await tx.user.update({
      where: { id },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(changingRole ? { role: input.role, tokenVersion: { increment: 1 } } : {}),
      },
      select: USER_SELECT,
    });
    await logAudit(
      {
        schoolId: actor.schoolId, actorId: actor.id, action: 'UPDATE_USER', entityType: 'User', entityId: id,
        detail: changingRole ? `Role ${target.role} → ${updated.role}` : 'Details changed',
        before: { fullName: target.fullName, email: target.email, role: target.role },
        after: { fullName: updated.fullName, email: updated.email, role: updated.role },
      },
      tx,
    );
    if (changingRole) {
      await notifyAdmins(tx, actor.schoolId, actor.id, { title: 'Role changed', body: `${updated.fullName} is now ${updated.role}.`, href: '/system/users' });
    }
    return updated;
  });
}

export async function setUserActive(
  db: ScopedDb,
  actor: { id: string; schoolId: string },
  id: string,
  active: boolean,
) {
  const target = await db.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!target) throw new ServiceError('User not found', 404);
  if (target.id === actor.id) throw new ServiceError('You cannot deactivate your own account', 409);
  if (target.active === active) throw new ServiceError(active ? 'This user is already active' : 'This user is already deactivated', 409);

  return db.$tx(async (tx) => {
    if (!active && (FULL_ACCESS_ROLES as readonly string[]).includes(target.role) && (await otherActiveAdmins(tx, id)) === 0) {
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
        entityType: 'User', entityId: id, detail: `${updated.fullName} (${updated.role})`,
        before: { active: target.active }, after: { active },
      },
      tx,
    );
    await notifyAdmins(tx, actor.schoolId, actor.id, {
      title: active ? 'User reactivated' : 'User deactivated',
      body: updated.fullName,
      href: '/system/users',
    });
    return updated;
  });
}

export async function resetUserPassword(db: ScopedDb, actor: { id: string; schoolId: string }, id: string) {
  const target = await db.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!target) throw new ServiceError('User not found', 404);
  if (!target.active) throw new ServiceError('This account is deactivated. Reactivate it first.', 409);

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await db.$tx(async (tx) => {
    // tokenVersion ends every session opened with the old password.
    await tx.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true, tokenVersion: { increment: 1 } } });
    await logAudit(
      { schoolId: actor.schoolId, actorId: actor.id, action: 'RESET_PASSWORD', entityType: 'User', entityId: id, detail: target.fullName },
      tx,
    );
  });
  return { tempPassword };
}

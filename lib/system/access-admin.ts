// Managing who may do what: custom roles, the roles a person holds (with the place they apply to), exceptions (overrides) and requests
// for access. Changing access is the most dangerous thing in the system, so every function here:
//   * is called after the route's permission check and checks the rules again (protected roles, nobody edits their own access,
//     finance and staff-pay permissions are the Owner's to give);
//   * does its writes in one transaction, with an audit entry that has the before and after values;
//   * moves the permVersion of everyone affected, so the change is felt within a minute without signing out.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { can, PERMISSIONS, type AccessUser } from '@/lib/access-core';
import { AccessError } from '@/lib/access/errors';
import { effectivePermissions, grantsFor } from '@/lib/access/effective';
import * as guards from '@/lib/access/guards';
import { narrowsOrEquals, SCOPES, type GrantRow, type OverrideRow, type PinType, type Scope } from '@/lib/access/types';
import { bumpHoldersOfRole, bumpPermVersion } from '@/lib/access/version';
import { accessFor, STAFF_ROLE_LABEL } from '@/lib/staff-roles';
import { adminIds, notifyUsers } from '@/lib/system/notifications';
import { assertRequiredRolesRemain, roleKeysOf } from '@/lib/system/users';
import type { Db, ScopedDb } from '@/lib/scoped-db';

/** Who is acting: their id, school, and the roles and permissions they hold. */
export type Actor = AccessUser & { roles?: string[] };

const DAY = 86_400_000;
export const MAX_OVERRIDE_DAYS = 90;
const PINNABLE: readonly Scope[] = ['DEPARTMENT', 'CLASS', 'HOSTEL', 'STORE'];
const KEY_RE = /^[a-z]+\.[a-z_]+\.[a-z_]+$/;

const label = (key: string) => (PERMISSIONS as Record<string, string>)[key] ?? key;
const roleLabel = (key: string, name?: string) => name ?? STAFF_ROLE_LABEL[key] ?? key;

const knownKey = (key: string) => key in PERMISSIONS && !key.startsWith('account.');
function assertKnownKey(key: string): void {
  if (!KEY_RE.test(key) || !knownKey(key)) throw new ServiceError(`"${key}" is not a permission`, 422);
}

// ─── Custom roles ────────────────────────────────────────────────────────────

export const CopyRoleSchema = z.object({
  fromKey: z.string().trim().min(1),
  name: z.string().trim().min(2, 'Give the role a name').max(60, 'The name is limited to 60 characters'),
  description: z.string().trim().max(200).optional(),
});

/** A role key is capitals and underscores only (a database rule), so a name becomes SENIOR_TEACHER, and a clash gets _X, _XX ... */
async function freshRoleKey(tx: Db, name: string): Promise<string> {
  const base = name.toUpperCase().replace(/[^A-Z]+/g, '_').replace(/^_+|_+$/g, '') || 'CUSTOM_ROLE';
  for (let n = 0; n < 20; n++) {
    const key = n === 0 ? base : `${base}_${'X'.repeat(n)}`;
    if (!(await tx.roleDefinition.findFirst({ where: { key }, select: { id: true } }))) return key;
  }
  throw new ServiceError('Choose a different name for the role', 409);
}

/**
 * Makes a custom role as a copy of any role. The Administrator may then take permissions out of it; only the Owner may add to it.
 * Copying a protected role (Owner, Head, Bursar, Administrator) is the Owner's, because the copy carries its permissions.
 */
export async function copyRole(db: ScopedDb, actor: Actor, raw: z.input<typeof CopyRoleSchema>) {
  const input = CopyRoleSchema.parse(raw);
  return db.$tx(async (tx) => {
    const source = await tx.roleDefinition.findFirst({ where: { key: input.fromKey }, select: { id: true, key: true, name: true, description: true, permissions: { select: { permissionKey: true, scope: true } } } });
    if (!source) throw new ServiceError('Role not found', 404);
    guards.protectedRolesNeedOwner(actor, [source.key]);
    if (source.permissions.some((p) => p.permissionKey === '*')) throw new ServiceError(`${roleLabel(source.key, source.name)} has full access, so it cannot be copied. Copy a role that lists what it may do.`, 409);

    const key = await freshRoleKey(tx, input.name);
    const created = await tx.roleDefinition.create({
      data: { schoolId: actor.schoolId, key, name: input.name, description: input.description || `A copy of ${source.name}.`, isSystem: false, copiedFromRoleId: source.id },
      select: { id: true },
    });
    if (source.permissions.length) {
      await tx.rolePermission.createMany({ data: source.permissions.map((p) => ({ schoolId: actor.schoolId, roleId: created.id, permissionKey: p.permissionKey, scope: p.scope })) });
    }
    await logAudit({
      schoolId: actor.schoolId, actorId: actor.id, action: 'ACCESS_ROLE_SAVED', entityType: 'RoleDefinition', entityId: created.id,
      detail: `Copied ${source.name} to a new role: ${input.name}`,
      after: { key, name: input.name, copiedFrom: source.key, permissions: source.permissions.length },
    }, tx);
    return { key, name: input.name };
  });
}

export const SaveRoleSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(200).optional(),
  grants: z.array(z.object({ key: z.string().trim(), scope: z.enum(SCOPES) })).max(500).optional(),
});

const grantList = (rows: { permissionKey: string; scope: string }[]) => rows.map((r) => `${r.permissionKey}@${r.scope}`).sort();

/**
 * Changes a custom role: its name and description, and what it grants. A permission taken out, or a grant narrowed, is the
 * Administrator's to do. A permission the copied role did not have, or a wider scope, is the Owner's (system.roles.edit).
 * System roles cannot be changed: a Pfuma update improves them for every school.
 */
export async function saveCustomRole(db: ScopedDb, actor: Actor, roleKey: string, raw: z.input<typeof SaveRoleSchema>) {
  const input = SaveRoleSchema.parse(raw);
  return db.$tx(async (tx) => {
    const role = await tx.roleDefinition.findFirst({
      where: { key: roleKey },
      select: { id: true, key: true, name: true, description: true, isSystem: true, copiedFromRoleId: true, permissions: { select: { permissionKey: true, scope: true } } },
    });
    if (!role) throw new ServiceError('Role not found', 404);
    if (role.isSystem) throw new AccessError('System roles cannot be changed. Copy it to a custom role instead.', 403, 'PROTECTED_ROLE');

    const before = { name: role.name, description: role.description, grants: grantList(role.permissions) };
    if (input.name !== undefined || input.description !== undefined) {
      await tx.roleDefinition.update({ where: { id: role.id }, data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}) } });
    }

    let changedGrants = false;
    if (input.grants) {
      const source = role.copiedFromRoleId
        ? await tx.rolePermission.findMany({ where: { roleId: role.copiedFromRoleId }, select: { permissionKey: true, scope: true } })
        : [];
      const sourceScope = new Map(source.map((s) => [s.permissionKey, s.scope as Scope]));
      const sourceAll = source.some((s) => s.permissionKey === '*');
      const wanted = new Map<string, Scope>();
      for (const g of input.grants) {
        if (g.key === '*') throw new ServiceError('A custom role cannot have full access', 422);
        assertKnownKey(g.key);
        if (g.scope === 'CHILDREN') throw new ServiceError('The parent-portal scope is not available yet', 422);
        wanted.set(g.key, g.scope);
      }
      let adds = false;
      wanted.forEach((scope, key) => {
        const was = sourceScope.get(key);
        if (!was && !sourceAll) adds = true;
        else if (was && !narrowsOrEquals(was, scope)) adds = true;
      });
      if (adds && !can(actor, 'system.roles.edit')) {
        throw new AccessError('You may take permissions out of a custom role, but only the Owner may add a permission the copied role did not have, or widen one.', 403, 'MISSING_PERMISSION', 'system.roles.edit');
      }
      const now = new Map(role.permissions.map((p) => [p.permissionKey, p.scope as Scope]));
      // Only a permission the role did not already have is "given"; keeping one it had (even a money key copied from another role) is not.
      wanted.forEach((scope, key) => { if (now.get(key) !== scope) guards.ownerOnlyKeyNeedsOwner(actor, key); });
      const removeKeys = Array.from(now.keys()).filter((k) => !wanted.has(k));
      if (removeKeys.length) await tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionKey: { in: removeKeys } } });
      const toAdd: { key: string; scope: Scope }[] = [];
      for (const [key, scope] of Array.from(wanted)) {
        if (!now.has(key)) toAdd.push({ key, scope });
        else if (now.get(key) !== scope) await tx.rolePermission.updateMany({ where: { roleId: role.id, permissionKey: key }, data: { scope } });
      }
      if (toAdd.length) await tx.rolePermission.createMany({ data: toAdd.map((a) => ({ schoolId: actor.schoolId, roleId: role.id, permissionKey: a.key, scope: a.scope })) });
      changedGrants = removeKeys.length > 0 || toAdd.length > 0 || Array.from(wanted).some(([k, s]) => now.get(k) !== s);
    }

    const after = await tx.roleDefinition.findUniqueOrThrow({ where: { id: role.id }, select: { name: true, description: true, permissions: { select: { permissionKey: true, scope: true } } } });
    await logAudit({
      schoolId: actor.schoolId, actorId: actor.id, action: 'ACCESS_ROLE_SAVED', entityType: 'RoleDefinition', entityId: role.id,
      detail: `Changed the role ${after.name}${changedGrants ? ' (permissions changed)' : ''}`,
      before, after: { name: after.name, description: after.description, grants: grantList(after.permissions) },
    }, tx);
    const affected = changedGrants ? await bumpHoldersOfRole(tx, role.id) : 0;
    return { key: role.key, changedGrants, peopleAffected: affected };
  });
}

/** Deletes a custom role that nobody holds. */
export async function deleteCustomRole(db: ScopedDb, actor: Actor, roleKey: string) {
  return db.$tx(async (tx) => {
    const role = await tx.roleDefinition.findFirst({ where: { key: roleKey }, select: { id: true, name: true, isSystem: true } });
    if (!role) throw new ServiceError('Role not found', 404);
    if (role.isSystem) throw new AccessError('System roles cannot be deleted.', 403, 'PROTECTED_ROLE');
    const holders = await tx.userRole.count({ where: { roleId: role.id } });
    if (holders > 0) throw new ServiceError(`${holders} ${holders === 1 ? 'person holds' : 'people hold'} this role. Give them another role first.`, 409);
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    await tx.roleDefinition.delete({ where: { id: role.id } });
    await logAudit({ schoolId: actor.schoolId, actorId: actor.id, action: 'ACCESS_ROLE_SAVED', entityType: 'RoleDefinition', entityId: role.id, detail: `Deleted the role ${role.name}`, before: { name: role.name } }, tx);
    return { deleted: true };
  });
}

// ─── The roles a person holds ────────────────────────────────────────────────

export const AssignRoleSchema = z.object({
  roleKey: z.string().trim().min(1),
  /** SCHOOL (the usual: where the role applies follows the records, such as the department someone heads) or one pinned place. */
  scopeType: z.enum(['SCHOOL', 'DEPARTMENT', 'CLASS', 'HOSTEL', 'STORE']).default('SCHOOL'),
  scopeId: z.string().trim().default(''),
});

async function placeExists(tx: Db, type: PinType, id: string): Promise<string | null> {
  switch (type) {
    case 'DEPARTMENT': return (await tx.department.findFirst({ where: { id }, select: { name: true } }))?.name ?? null;
    case 'CLASS': return (await tx.schoolClass.findFirst({ where: { id }, select: { name: true } }))?.name ?? null;
    case 'HOSTEL': return (await tx.facHostel.findFirst({ where: { id }, select: { name: true } }))?.name ?? null;
    case 'STORE': return (await tx.facStore.findFirst({ where: { id }, select: { name: true } }))?.name ?? null;
    default: return '';
  }
}

async function loadTarget(tx: Db, userId: string) {
  const u = await tx.user.findFirst({ where: { id: userId, isSupport: false }, select: { id: true, fullName: true, active: true } });
  if (!u) throw new ServiceError('User not found', 404);
  return { ...u, roles: await roleKeysOf(tx, userId) };
}

/** Keeps the older single access level in step with the roles held (it still drives a few older screens). */
async function syncLegacyLevel(tx: Db, userId: string): Promise<void> {
  const keys = await roleKeysOf(tx, userId);
  const level = accessFor(keys);
  const current = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
  if (current.role === level) return;
  // A database trigger resets a person's roles to the single matching role whenever the older level changes, so the rows
  // (with their places and who gave them) are put back straight after.
  const held = await tx.userRole.findMany({ where: { userId } });
  await tx.user.update({ where: { id: userId }, data: { role: level } });
  await tx.userRole.deleteMany({ where: { userId } });
  await tx.userRole.createMany({ data: held.map((h) => ({ id: h.id, schoolId: h.schoolId, userId: h.userId, roleId: h.roleId, scopeType: h.scopeType, scopeId: h.scopeId, assignedById: h.assignedById, createdAt: h.createdAt })) });
}

/** Gives a person a role, for the whole school or pinned to one department, class, hostel or store. */
export async function assignRole(db: ScopedDb, actor: Actor, userId: string, raw: z.input<typeof AssignRoleSchema>) {
  const input = AssignRoleSchema.parse(raw);
  guards.cannotChangeOwnAccess(actor, userId);
  return db.$tx(async (tx) => {
    const target = await loadTarget(tx, userId);
    if (!target.active) throw new ServiceError('This account is deactivated. Reactivate it first.', 409);
    const role = await tx.roleDefinition.findFirst({ where: { key: input.roleKey }, select: { id: true, key: true, name: true, permissions: { select: { scope: true } } } });
    if (!role) throw new ServiceError('Role not found', 404);
    guards.protectedRolesNeedOwner({ id: actor.id, roles: await roleKeysOf(tx, actor.id) }, [role.key]);

    let scopeId = '';
    let place = '';
    if (input.scopeType !== 'SCHOOL') {
      const pinnable = new Set(role.permissions.map((p) => p.scope).filter((s) => PINNABLE.includes(s as Scope)));
      if (!pinnable.has(input.scopeType)) throw new ServiceError(`${role.name} does not apply to one ${input.scopeType.toLowerCase()}. Give it for the whole school.`, 422);
      if (!input.scopeId) throw new ServiceError(`Choose the ${input.scopeType.toLowerCase()}`, 422);
      const name = await placeExists(tx, input.scopeType, input.scopeId);
      if (name === null) throw new ServiceError(`That ${input.scopeType.toLowerCase()} was not found`, 404);
      scopeId = input.scopeId;
      place = name;
    }
    if (await tx.userRole.findFirst({ where: { userId, roleId: role.id, scopeType: input.scopeType, scopeId }, select: { id: true } })) {
      throw new ServiceError(`${target.fullName} already holds ${role.name}${place ? ` for ${place}` : ''}`, 409);
    }

    const row = await tx.userRole.create({ data: { schoolId: actor.schoolId, userId, roleId: role.id, scopeType: input.scopeType, scopeId, assignedById: actor.id }, select: { id: true } });
    await syncLegacyLevel(tx, userId);
    await bumpPermVersion(tx, [userId]);
    await logAudit({
      schoolId: actor.schoolId, actorId: actor.id, action: 'ACCESS_ROLE_ASSIGNED', entityType: 'User', entityId: userId,
      detail: `${target.fullName} was given ${role.name}${place ? ` for ${place}` : ''}`,
      before: { roles: target.roles }, after: { roles: [...target.roles, role.key], added: { role: role.key, scopeType: input.scopeType, scopeId } },
    }, tx);
    await notifyUsers(tx, actor.schoolId, [userId], { type: 'ROLES_CHANGED', title: 'You were given a role', body: `You are now ${roleLabel(role.key, role.name)}${place ? ` for ${place}` : ''}.`, link: '/system/profile' });
    return { id: row.id };
  });
}

/** Takes one role away from a person. The school keeps at least one active Owner and one active Administrator. */
export async function removeRole(db: ScopedDb, actor: Actor, userId: string, userRoleId: string) {
  guards.cannotChangeOwnAccess(actor, userId);
  return db.$tx(async (tx) => {
    const target = await loadTarget(tx, userId);
    const row = await tx.userRole.findFirst({ where: { id: userRoleId, userId }, select: { id: true, scopeType: true, scopeId: true, role: { select: { key: true, name: true } } } });
    if (!row) throw new ServiceError('That role was not found on this person', 404);
    guards.protectedRolesNeedOwner({ id: actor.id, roles: await roleKeysOf(tx, actor.id) }, [row.role.key]);

    const others = await tx.userRole.findMany({ where: { userId, NOT: { id: row.id } }, select: { role: { select: { key: true } } } });
    const after = Array.from(new Set(others.map((o) => o.role.key)));
    await assertRequiredRolesRemain(tx, actor.schoolId, target, { active: target.active, roles: after });

    await tx.userRole.delete({ where: { id: row.id } });
    await syncLegacyLevel(tx, userId);
    await bumpPermVersion(tx, [userId]);
    await logAudit({
      schoolId: actor.schoolId, actorId: actor.id, action: 'ACCESS_ROLE_REMOVED', entityType: 'User', entityId: userId,
      detail: `${target.fullName} no longer holds ${row.role.name}`,
      before: { roles: target.roles, removed: { role: row.role.key, scopeType: row.scopeType, scopeId: row.scopeId } }, after: { roles: after },
    }, tx);
    await notifyUsers(tx, actor.schoolId, [userId], { type: 'ROLES_CHANGED', title: 'A role was taken away', body: `You are no longer ${roleLabel(row.role.key, row.role.name)}.`, link: '/system/profile' });
    return { removed: true };
  });
}

// ─── Exceptions (overrides) ──────────────────────────────────────────────────

export const OverrideSchema = z.object({
  permissionKey: z.string().trim().min(1),
  effect: z.enum(['GRANT', 'DENY']),
  scope: z.enum(SCOPES).default('SCHOOL'),
  scopeId: z.string().trim().default(''),
  reason: z.string().trim().min(3, 'Give a reason').max(300, 'The reason is limited to 300 characters'),
  days: z.number().int('Whole days').min(1, 'At least one day').max(MAX_OVERRIDE_DAYS, `At most ${MAX_OVERRIDE_DAYS} days`),
});

interface NewOverride { userId: string; input: z.output<typeof OverrideSchema>; actor: Actor; now: Date }

/** Shared by "add an exception" and "approve an access request": the checks, the row, the audit entry and the version bump. */
async function insertOverride(tx: Db, { userId, input, actor, now }: NewOverride) {
  guards.cannotChangeOwnAccess(actor, userId);
  assertKnownKey(input.permissionKey);
  guards.ownerOnlyKeyNeedsOwner({ id: actor.id, roles: await roleKeysOf(tx, actor.id) }, input.permissionKey);
  if (input.scope === 'CHILDREN') throw new ServiceError('The parent-portal scope is not available yet', 422);
  const pinned = PINNABLE.includes(input.scope);
  if (pinned && !input.scopeId) throw new ServiceError(`Choose the ${input.scope.toLowerCase()} this exception is for`, 422);
  if (!pinned && input.scopeId) throw new ServiceError('A place can only be named for a department, class, hostel or store', 422);
  if (pinned && (await placeExists(tx, input.scope as PinType, input.scopeId)) === null) throw new ServiceError(`That ${input.scope.toLowerCase()} was not found`, 404);

  const target = await tx.user.findFirst({ where: { id: userId, isSupport: false }, select: { id: true, fullName: true, active: true } });
  if (!target) throw new ServiceError('User not found', 404);
  if (!target.active) throw new ServiceError('This account is deactivated.', 409);

  const expiresAt = new Date(now.getTime() + input.days * DAY);
  const row = await tx.userPermissionOverride.create({
    data: {
      schoolId: actor.schoolId, userId, permissionKey: input.permissionKey, scope: input.scope, scopeId: input.scopeId, effect: input.effect,
      reason: input.reason, expiresAt, createdById: actor.id, createdAt: now,
    },
    select: { id: true },
  });
  await bumpPermVersion(tx, [userId]);
  await logAudit({
    schoolId: actor.schoolId, actorId: actor.id, action: 'ACCESS_OVERRIDE_SAVED', entityType: 'User', entityId: userId,
    detail: `${input.effect === 'GRANT' ? 'Gave' : 'Denied'} ${target.fullName} "${label(input.permissionKey)}" until ${expiresAt.toISOString().slice(0, 10)}: ${input.reason}`,
    before: { overrides: 'none for this permission' },
    after: { overrideId: row.id, permissionKey: input.permissionKey, effect: input.effect, scope: input.scope, scopeId: input.scopeId, expiresAt: expiresAt.toISOString(), reason: input.reason },
  }, tx);
  await notifyUsers(tx, actor.schoolId, [userId], {
    type: 'ACCESS', title: input.effect === 'GRANT' ? 'You were given temporary access' : 'A permission was switched off for you',
    body: `${label(input.permissionKey)} until ${expiresAt.toISOString().slice(0, 10)}.`, link: '/system/profile',
  });
  return { id: row.id, expiresAt, targetName: target.fullName };
}

/** Gives or denies one permission to one person for up to 90 days. A deny beats any grant. */
export async function createOverride(db: ScopedDb, actor: Actor, userId: string, raw: z.input<typeof OverrideSchema>) {
  const input = OverrideSchema.parse(raw);
  return db.$tx((tx) => insertOverride(tx, { userId, input, actor, now: new Date() }));
}

/** Ends an exception now. It stays in the history. */
export async function revokeOverride(db: ScopedDb, actor: Actor, overrideId: string) {
  return db.$tx(async (tx) => {
    const row = await tx.userPermissionOverride.findFirst({ where: { id: overrideId }, select: { id: true, userId: true, permissionKey: true, effect: true, revokedAt: true, expiresAt: true, user: { select: { fullName: true } } } });
    if (!row) throw new ServiceError('Exception not found', 404);
    if (row.revokedAt) throw new ServiceError('This exception has already ended', 409);
    guards.cannotChangeOwnAccess(actor, row.userId);
    guards.ownerOnlyKeyNeedsOwner({ id: actor.id, roles: await roleKeysOf(tx, actor.id) }, row.permissionKey);
    await tx.userPermissionOverride.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await bumpPermVersion(tx, [row.userId]);
    await logAudit({
      schoolId: actor.schoolId, actorId: actor.id, action: 'ACCESS_OVERRIDE_REVOKED', entityType: 'User', entityId: row.userId,
      detail: `Ended the exception "${label(row.permissionKey)}" for ${row.user.fullName}`,
      before: { overrideId: row.id, effect: row.effect, expiresAt: row.expiresAt.toISOString(), revoked: false }, after: { revoked: true },
    }, tx);
    return { revoked: true };
  });
}

// ─── Requests for access ─────────────────────────────────────────────────────

export const RequestAccessSchema = z.object({
  permissionKey: z.string().trim().min(1),
  page: z.string().trim().max(200).default(''),
  reason: z.string().trim().min(3, 'Say why you need it').max(500),
});

/** People who decide a request: the Owner for money and staff-pay permissions; the Administrator (and the Owner) for the rest. */
async function deciders(tx: Db, schoolId: string, key: string, exceptUserId: string): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: {
      schoolId, active: true, isSupport: false, id: { not: exceptUserId },
      userRoles: { some: { role: { key: { in: guards.isOwnerOnlyKey(key) ? ['OWNER'] : ['OWNER', 'ADMINISTRATOR'] } } } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** "Request access" on the access-denied page. One open request per person per permission. */
export async function requestAccess(db: ScopedDb, user: Actor, raw: z.input<typeof RequestAccessSchema>) {
  const input = RequestAccessSchema.parse(raw);
  assertKnownKey(input.permissionKey);
  if (can(user, input.permissionKey)) throw new ServiceError('You already have this permission', 409);
  return db.$tx(async (tx) => {
    if (await tx.accessRequest.findFirst({ where: { userId: user.id, permissionKey: input.permissionKey, status: 'PENDING' }, select: { id: true } })) {
      throw new ServiceError('You have already asked for this. It is waiting for a decision.', 409);
    }
    const row = await tx.accessRequest.create({ data: { schoolId: user.schoolId, userId: user.id, permissionKey: input.permissionKey, page: input.page, reason: input.reason }, select: { id: true } });
    await logAudit({
      schoolId: user.schoolId, actorId: user.id, action: 'ACCESS_REQUESTED', entityType: 'AccessRequest', entityId: row.id,
      detail: `Asked for "${label(input.permissionKey)}"${input.page ? ` (from ${input.page})` : ''}: ${input.reason}`,
      after: { permissionKey: input.permissionKey, page: input.page },
    }, tx);
    let who = await deciders(tx, user.schoolId, input.permissionKey, user.id);
    if (who.length === 0) who = await adminIds(tx, user.schoolId, user.id);
    await notifyUsers(tx, user.schoolId, who, { type: 'ACCESS_REQUEST', title: 'Someone asked for access', body: `${label(input.permissionKey)}: ${input.reason}`.slice(0, 200), link: '/system/roles?tab=requests', dedupeKey: `request:${row.id}` });
    return { id: row.id };
  });
}

export const DecideRequestSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('APPROVE'),
    days: z.number().int().min(1).max(MAX_OVERRIDE_DAYS).default(30),
    scope: z.enum(SCOPES).default('SCHOOL'),
    scopeId: z.string().trim().default(''),
  }),
  z.object({ decision: z.literal('DECLINE'), reason: z.string().trim().min(3, 'Say why it is declined').max(300) }),
]);

/** Approves a request as a time-limited exception, or declines it with a reason. */
export async function decideRequest(db: ScopedDb, actor: Actor, requestId: string, raw: z.input<typeof DecideRequestSchema>) {
  const input = DecideRequestSchema.parse(raw);
  return db.$tx(async (tx) => {
    const req = await tx.accessRequest.findFirst({ where: { id: requestId }, select: { id: true, userId: true, permissionKey: true, page: true, reason: true, status: true, user: { select: { fullName: true } } } });
    if (!req) throw new ServiceError('Request not found', 404);
    if (req.status !== 'PENDING') throw new ServiceError('This request has already been decided', 409);
    if (req.userId === actor.id) throw new AccessError('You asked for this yourself, so someone else must decide it.', 403, 'SEPARATION_OF_DUTIES', undefined, 8);
    guards.ownerOnlyKeyNeedsOwner({ id: actor.id, roles: await roleKeysOf(tx, actor.id) }, req.permissionKey);

    const now = new Date();
    if (input.decision === 'DECLINE') {
      await tx.accessRequest.update({ where: { id: req.id }, data: { status: 'DECLINED', decidedById: actor.id, decidedAt: now, decisionNote: input.reason } });
      await logAudit({
        schoolId: actor.schoolId, actorId: actor.id, action: 'ACCESS_REQUEST_DECIDED', entityType: 'AccessRequest', entityId: req.id,
        detail: `Declined ${req.user.fullName}'s request for "${label(req.permissionKey)}": ${input.reason}`, before: { status: 'PENDING' }, after: { status: 'DECLINED', reason: input.reason },
      }, tx);
      await notifyUsers(tx, actor.schoolId, [req.userId], { type: 'ACCESS_REQUEST', title: 'Your request was declined', body: `${label(req.permissionKey)}: ${input.reason}`, link: '/system/profile' });
      return { status: 'DECLINED' as const };
    }

    const made = await insertOverride(tx, {
      userId: req.userId, actor, now,
      input: { permissionKey: req.permissionKey, effect: 'GRANT', scope: input.scope, scopeId: input.scopeId, days: input.days, reason: `Access request approved: ${req.reason}`.slice(0, 300) },
    });
    await tx.accessRequest.update({ where: { id: req.id }, data: { status: 'APPROVED', decidedById: actor.id, decidedAt: now, resultingOverrideId: made.id } });
    await logAudit({
      schoolId: actor.schoolId, actorId: actor.id, action: 'ACCESS_REQUEST_DECIDED', entityType: 'AccessRequest', entityId: req.id,
      detail: `Approved ${req.user.fullName}'s request for "${label(req.permissionKey)}" until ${made.expiresAt.toISOString().slice(0, 10)}`, before: { status: 'PENDING' }, after: { status: 'APPROVED', overrideId: made.id },
    }, tx);
    return { status: 'APPROVED' as const, overrideId: made.id, expiresAt: made.expiresAt };
  });
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export interface AccessViewKey { key: string; label: string; scopes: Scope[]; via: string[] }
export interface AccessView {
  user: { id: string; fullName: string; email: string; active: boolean };
  roles: { id: string; key: string; name: string; scopeType: string; scopeId: string; place: string | null; isSystem: boolean }[];
  overrides: OverrideListRow[];
  /** What the person may do now, by module. */
  effective: { module: string; keys: AccessViewKey[] }[];
  everything: boolean;
  denied: { id: string; key: string; detail: string | null; at: string }[];
}

export interface OverrideListRow {
  id: string; userId: string; userName: string; permissionKey: string; label: string; effect: 'GRANT' | 'DENY'; scope: string; scopeId: string;
  reason: string; expiresAt: string; createdAt: string; createdBy: string; revokedAt: string | null; state: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
}

const stateOf = (o: { revokedAt: Date | null; expiresAt: Date }, now: Date): OverrideListRow['state'] => (o.revokedAt ? 'REVOKED' : o.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : 'ACTIVE');

async function overrideRows(tx: Db, where: { userId?: string }, now: Date, limit = 500): Promise<OverrideListRow[]> {
  const rows = await tx.userPermissionOverride.findMany({
    where, orderBy: { createdAt: 'desc' }, take: limit,
    select: { id: true, userId: true, permissionKey: true, effect: true, scope: true, scopeId: true, reason: true, expiresAt: true, createdAt: true, revokedAt: true, user: { select: { fullName: true } }, createdBy: { select: { fullName: true } } },
  });
  return rows.map((r) => ({
    id: r.id, userId: r.userId, userName: r.user.fullName, permissionKey: r.permissionKey, label: label(r.permissionKey), effect: r.effect, scope: r.scope, scopeId: r.scopeId,
    reason: r.reason, expiresAt: r.expiresAt.toISOString(), createdAt: r.createdAt.toISOString(), createdBy: r.createdBy.fullName, revokedAt: r.revokedAt?.toISOString() ?? null, state: stateOf(r, now),
  }));
}

/** "What can this user do?": their roles (with the place each applies to), their exceptions, the permissions that follow, and recent refusals. */
export async function describeAccess(db: ScopedDb, userId: string, now = new Date()): Promise<AccessView> {
  const u = await db.user.findFirst({ where: { id: userId, isSupport: false }, select: { id: true, fullName: true, email: true, active: true } });
  if (!u) throw new ServiceError('User not found', 404);
  const held = await db.userRole.findMany({
    where: { userId }, orderBy: { createdAt: 'asc' },
    select: { id: true, scopeType: true, scopeId: true, role: { select: { key: true, name: true, isSystem: true, permissions: { select: { permissionKey: true, scope: true } } } } },
  });
  const school = await db.school.findFirst({ select: { singlePersonFinance: true } });
  const overrides = await overrideRows(db, { userId }, now);

  const rows: GrantRow[] = held.flatMap((h) => h.role.permissions.map((p) => ({ key: p.permissionKey, scope: p.scope as Scope, pinType: h.scopeType as PinType, pinId: h.scopeId })));
  const liveOverrides: OverrideRow[] = overrides.filter((o) => o.state === 'ACTIVE').map((o) => ({ key: o.permissionKey, scope: o.scope as Scope, scopeId: o.scopeId, effect: o.effect, expiresAt: new Date(o.expiresAt), revokedAt: null }));
  const eff = effectivePermissions({ roleGrants: rows, overrides: liveOverrides, roleKeys: held.map((h) => h.role.key), singlePersonFinance: school?.singlePersonFinance ?? false, now });

  const viaOf = (key: string) => {
    const out: string[] = [];
    for (const h of held) if (h.role.permissions.some((p) => p.permissionKey === key || p.permissionKey === '*')) out.push(roleLabel(h.role.key, h.role.name));
    for (const o of overrides) if (o.state === 'ACTIVE' && o.permissionKey === key && o.effect === 'GRANT') out.push('Exception');
    return Array.from(new Set(out));
  };
  const everything = eff.grants.has('*') && !eff.denied.size;
  const byModule = new Map<string, AccessViewKey[]>();
  for (const key of Object.keys(PERMISSIONS)) {
    if (key.startsWith('account.')) continue;
    const g = grantsFor(eff, key);
    if (!g.length) continue;
    const m = key.split('.')[0]!;
    byModule.set(m, [...(byModule.get(m) ?? []), { key, label: label(key), scopes: Array.from(new Set(g.map((x) => x.scope))), via: viaOf(key) }]);
  }

  const placeNames = async (type: string, id: string): Promise<string | null> => (id && PINNABLE.includes(type as Scope) ? placeExists(db as unknown as Db, type as PinType, id) : null);
  const roles = [];
  for (const h of held) roles.push({ id: h.id, key: h.role.key, name: h.role.name, scopeType: h.scopeType, scopeId: h.scopeId, place: await placeNames(h.scopeType, h.scopeId), isSystem: h.role.isSystem });

  const denied = (await db.auditLog.findMany({ where: { actorId: userId, action: 'ACCESS_DENIED' }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, entityId: true, detail: true, createdAt: true } }))
    .map((d) => ({ id: d.id, key: d.entityId, detail: d.detail, at: d.createdAt.toISOString() }));

  return {
    user: u, roles, overrides, everything,
    effective: Array.from(byModule).map(([module, keys]) => ({ module, keys })),
    denied,
  };
}

/** The "Active exceptions" report: every exception in force in the school (and, if asked, the history of the ended ones). */
export async function listExceptions(db: ScopedDb, opts: { history?: boolean } = {}, now = new Date()): Promise<OverrideListRow[]> {
  const rows = await overrideRows(db, {}, now, opts.history ? 500 : 300);
  return opts.history ? rows : rows.filter((r) => r.state === 'ACTIVE');
}

export interface RequestRow {
  id: string; userId: string; userName: string; permissionKey: string; label: string; page: string; reason: string; status: 'PENDING' | 'APPROVED' | 'DECLINED';
  createdAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; ownerOnly: boolean;
}

export async function listRequests(db: ScopedDb, opts: { status?: 'PENDING' | 'APPROVED' | 'DECLINED' } = {}): Promise<RequestRow[]> {
  const rows = await db.accessRequest.findMany({
    where: opts.status ? { status: opts.status } : {}, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 200,
    select: { id: true, userId: true, permissionKey: true, page: true, reason: true, status: true, createdAt: true, decidedAt: true, decisionNote: true, user: { select: { fullName: true } }, decidedBy: { select: { fullName: true } } },
  });
  return rows.map((r) => ({
    id: r.id, userId: r.userId, userName: r.user.fullName, permissionKey: r.permissionKey, label: label(r.permissionKey), page: r.page, reason: r.reason, status: r.status,
    createdAt: r.createdAt.toISOString(), decidedBy: r.decidedBy?.fullName ?? null, decidedAt: r.decidedAt?.toISOString() ?? null, decisionNote: r.decisionNote, ownerOnly: guards.isOwnerOnlyKey(r.permissionKey),
  }));
}

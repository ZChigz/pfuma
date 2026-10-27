// Server side of the permission check. See lib/access-core.ts for can() and the permission catalogue, and lib/access/ for the engine
// (scopes, scopeWhere, separation-of-duties guards, serializers).
//
//   API route:   const user = await requirePermission('system.users.create');
//                const user = await requirePermission('exams.marks.enter', { model: 'TeacherAssignment', id });   // checks the record's scope too
//   Page:        const { user, can } = await getAccess();
//                if (!can('system.users.view')) return <AccessDenied />;
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiForbidden, apiUnauthorized } from '@/lib/api';
import { can, disabledModulesFrom, type AccessScope, type AccessUser, type PermissionKey } from '@/lib/access-core';
import { assertAllowed, canAccess } from '@/lib/access/check';
import { effectivePermissions, heldKeys } from '@/lib/access/effective';
import type { GrantRow, OverrideRow, PinType, Resource, Scope } from '@/lib/access/types';
import type { UserRole } from '@/types';

export * from '@/lib/access-core';
export { reachesSheet } from '@/lib/access/legacy';
export * as guards from '@/lib/access/guards';

/** The signed-in user plus what the check needs: switched-off modules and what their roles grant. */
export interface AccessContext extends AccessUser {
  email: string;
  fullName: string;
  /** Keys of the roles the person holds (OWNER, TEACHER ...). */
  roles: string[];
  /** A Pfuma support person looking at this school, read-only. */
  support: boolean;
  /** The school's subscription status, for the banner. */
  schoolStatus: 'TRIAL' | 'ACTIVE' | 'OVERDUE' | 'SUSPENDED';
}

type SessionLike = {
  user: { id: string; schoolId: string; role: UserRole; email: string; fullName: string; support?: boolean };
};

async function loadContext(session: SessionLike): Promise<AccessContext> {
  const u = session.user;
  const db = getScopedDb(u.schoolId, u.id);
  const now = new Date();
  const [modules, held, school, overrides, me] = await Promise.all([
    db.schoolModule.findMany({ where: { enabled: false }, select: { module: true, enabled: true } }),
    db.userRole.findMany({
      where: { userId: u.id },
      select: { scopeType: true, scopeId: true, role: { select: { key: true, permissions: { select: { permissionKey: true, scope: true } } } } },
    }),
    db.school.findUnique({ where: { id: u.schoolId }, select: { status: true, singlePersonFinance: true, previousTermReadDays: true } }),
    db.userPermissionOverride.findMany({ where: { userId: u.id, revokedAt: null, expiresAt: { gt: now } }, select: { permissionKey: true, scope: true, scopeId: true, effect: true, expiresAt: true, revokedAt: true } }),
    db.user.findUnique({ where: { id: u.id }, select: { permVersion: true, active: true } }),
  ]);
  // Check 1: signed in and active. The session token is only read again every 60 seconds, so a person deactivated in between is stopped here.
  if (!me || !me.active) throw apiUnauthorized();
  const schoolStatus = school?.status ?? 'ACTIVE';
  const support = u.support === true;
  const roles = Array.from(new Set(held.map((h) => h.role.key)));

  // Nobody holds "*" any more (the database refuses the row). A stray one is ignored rather than trusted.
  const roleGrants: GrantRow[] = held.flatMap((h) =>
    h.role.permissions.filter((p) => p.permissionKey !== '*').map((p) => ({ key: p.permissionKey, scope: p.scope as Scope, pinType: h.scopeType as PinType, pinId: h.scopeId })));
  const overrideRows: OverrideRow[] = overrides.map((o) => ({ key: o.permissionKey, scope: o.scope as Scope, scopeId: o.scopeId, effect: o.effect, expiresAt: o.expiresAt, revokedAt: o.revokedAt }));
  const effective = effectivePermissions({ roleGrants, overrides: overrideRows, roleKeys: roles, singlePersonFinance: school?.singlePersonFinance ?? false, now });

  return {
    id: u.id,
    schoolId: u.schoolId,
    role: u.role,
    email: u.email,
    fullName: u.fullName,
    disabledModules: disabledModulesFrom(modules),
    roles,
    grants: heldKeys(effective),
    effective,
    denied: Array.from(effective.denied),
    permVersion: me?.permVersion ?? 0,
    previousTermReadDays: school?.previousTermReadDays ?? 30,
    // A suspended school, and a support person, can look but not change.
    readOnly: schoolStatus === 'SUSPENDED' || support,
    noExport: support,
    support,
    schoolStatus,
  };
}

/** The context of a person, built the way requirePermission builds it (for services that are given a user id, and for tests). */
export const loadAccessContext = loadContext;

const isResource = (x: AccessScope | Resource | undefined): x is Resource => !!x && 'model' in x;

/**
 * For API routes. Resolves to the signed-in user when they hold `permission`; otherwise throws a 401 Response or an AccessError (403
 * with the reason and who can do it instead), which withApi returns as-is. Given a record (`{ model, id }` or a loaded record) it also
 * checks that the record is inside the scope of the grant: another school's record is "not found", never "forbidden".
 */
export async function requirePermission(permission: PermissionKey, scope?: AccessScope | Resource): Promise<AccessContext> {
  const session = await auth();
  if (!session?.user?.id) throw apiUnauthorized();
  const ctx = await loadContext(session as never);
  if (isResource(scope)) {
    await assertAllowed(ctx, permission, scope);
    return ctx;
  }
  if (scope?.schoolId !== undefined && scope.schoolId !== ctx.schoolId) throw apiForbidden();
  await assertAllowed(ctx, permission);
  return ctx;
}

/**
 * For the older routes that already hold the session user: loads the person's access and checks `permission` (and a record, when given).
 * Throws the same 403/404 AccessError as requirePermission, which withApi returns as a JSON message.
 */
export async function authorize(
  sessionUser: SessionLike['user'],
  permission: PermissionKey,
  scope?: AccessScope | Resource,
): Promise<AccessContext> {
  const ctx = await loadContext({ user: sessionUser });
  if (isResource(scope)) {
    await assertAllowed(ctx, permission, scope);
    return ctx;
  }
  if (scope?.schoolId !== undefined && scope.schoolId !== ctx.schoolId) throw apiForbidden();
  await assertAllowed(ctx, permission);
  return ctx;
}

/** Like authorize, for a route any one of several keys opens. The refusal names the first key. */
export async function authorizeAny(sessionUser: SessionLike['user'], permissions: readonly PermissionKey[]): Promise<AccessContext> {
  const ctx = await loadContext({ user: sessionUser });
  if (permissions.some((k) => can(ctx, k))) return ctx;
  await assertAllowed(ctx, permissions[0]!);
  throw apiForbidden();
}

/**
 * For the older pages that already hold the session user: loads the person's access and sends them to `redirectTo` unless they hold
 * `permission` (or any of the keys given). Returns the context, for the buttons and fields the page then shows or hides.
 */
export async function guardPage(
  sessionUser: SessionLike['user'],
  permission: PermissionKey | readonly PermissionKey[],
  redirectTo = '/',
): Promise<AccessContext> {
  const ctx = await loadContext({ user: sessionUser }).catch((e) => {
    if (e instanceof Response && e.status === 401) redirect('/login');
    throw e;
  });
  const keys = Array.isArray(permission) ? permission : [permission];
  if (!keys.some((k) => can(ctx, k))) redirect(redirectTo);
  return ctx;
}

/** For pages and layouts: the user (redirecting to sign-in when there is none) and a bound can(). */
export async function getAccess(): Promise<{
  user: AccessContext;
  can: (permission: PermissionKey, scope?: AccessScope) => boolean;
  /** The same check for one record: module, key and scope. Another school's record throws "not found". */
  canAccess: (permission: PermissionKey, resource: Resource) => Promise<boolean>;
}> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = await loadContext(session as never).catch((e) => {
    if (e instanceof Response && e.status === 401) redirect('/login');
    throw e;
  });
  return { user, can: (permission, scope) => can(user, permission, scope), canAccess: (permission, resource) => canAccess(user, permission, resource) };
}

/** The signed-in user for self-service routes (profile, password, notifications): any signed-in person. */
export async function requireSignedIn(): Promise<AccessContext> {
  const session = await auth();
  if (!session?.user?.id) throw apiUnauthorized();
  return loadContext(session as never);
}

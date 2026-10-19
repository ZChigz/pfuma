// Server side of the permission check. See lib/access-core.ts for can() and the
// permission catalogue.
//
//   API route:   const user = await requirePermission('system.users.create');
//   Page:        const { user, can } = await getAccess();
//                if (!can('system.users.view')) return <AccessDenied />;
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiForbidden, apiUnauthorized } from '@/lib/api';
import { can, disabledModulesFrom, type AccessScope, type AccessUser, type PermissionKey } from '@/lib/access-core';
import type { UserRole } from '@/types';

export * from '@/lib/access-core';

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
  const [modules, held, school] = await Promise.all([
    db.schoolModule.findMany({ where: { enabled: false }, select: { module: true, enabled: true } }),
    db.userRole.findMany({
      where: { userId: u.id },
      select: { role: { select: { key: true, permissions: { select: { permissionKey: true } } } } },
    }),
    db.school.findUnique({ where: { id: u.schoolId }, select: { status: true } }),
  ]);
  const schoolStatus = school?.status ?? 'ACTIVE';
  const support = u.support === true;
  return {
    id: u.id,
    schoolId: u.schoolId,
    role: u.role,
    email: u.email,
    fullName: u.fullName,
    disabledModules: disabledModulesFrom(modules),
    roles: Array.from(new Set(held.map((h) => h.role.key))),
    grants: Array.from(new Set(held.flatMap((h) => h.role.permissions.map((p) => p.permissionKey)))),
    // A suspended school, and a support person, can look but not change.
    readOnly: schoolStatus === 'SUSPENDED' || support,
    noExport: support,
    support,
    schoolStatus,
  };
}

/**
 * For API routes. Resolves to the signed-in user when they hold `permission`;
 * otherwise throws a 401/403 Response, which withApi returns as-is.
 */
export async function requirePermission(permission: PermissionKey, scope?: AccessScope): Promise<AccessContext> {
  const session = await auth();
  if (!session?.user?.id) throw apiUnauthorized();
  const ctx = await loadContext(session as never);
  if (!can(ctx, permission, scope)) throw apiForbidden();
  return ctx;
}

/** For pages and layouts: the user (redirecting to sign-in when there is none) and a bound can(). */
export async function getAccess(): Promise<{
  user: AccessContext;
  can: (permission: PermissionKey, scope?: AccessScope) => boolean;
}> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = await loadContext(session as never);
  return { user, can: (permission, scope) => can(user, permission, scope) };
}

/** The signed-in user for self-service routes (profile, password, notifications): any signed-in person. */
export async function requireSignedIn(): Promise<AccessContext> {
  const session = await auth();
  if (!session?.user?.id) throw apiUnauthorized();
  return loadContext(session as never);
}

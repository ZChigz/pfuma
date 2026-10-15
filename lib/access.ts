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

/** The signed-in user plus what the check needs: switched-off modules and role grants. */
export interface AccessContext extends AccessUser {
  email: string;
  fullName: string;
}

async function loadContext(session: { user: { id: string; schoolId: string; role: UserRole; email: string; fullName: string } }): Promise<AccessContext> {
  const u = session.user;
  const db = getScopedDb(u.schoolId, u.id);
  const [modules, grants] = await Promise.all([
    db.schoolModule.findMany({ where: { enabled: false }, select: { module: true, enabled: true } }),
    db.rolePermission.findMany({ where: { role: u.role }, select: { permission: true } }),
  ]);
  return {
    id: u.id,
    schoolId: u.schoolId,
    role: u.role,
    email: u.email,
    fullName: u.fullName,
    disabledModules: disabledModulesFrom(modules),
    grants: grants.map((g) => g.permission),
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

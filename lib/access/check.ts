// The checks of the seven-step access check that need the database, with the reasons a refusal gives.
//
//   1. signed in and active          → the session (lib/auth.ts, middleware)
//   2. same school                   → inScope(): another school's record is "not found" (404), never "forbidden"
//   3. module on                     → can()
//   4. holds the key                 → can()
//   5. in scope                      → inScope(), through scopeWhere()
//   6. not own record                → lib/access/guards.ts, called by the service that has the record
//   7. record open                   → the service (term closed, sheet locked, run approved ...)
import { can, moduleOf, PERMISSIONS, type AccessUser } from '@/lib/access-core';
import { MODULES } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { notify } from '@/lib/system/notifications';
import { AccessError, notFound } from './errors';
import { grantsFor } from './effective';
import { scopeWhere } from './where';
import { effectiveOf } from './user';
import { LOOKING_ACTIONS, type Resource } from './types';

type Delegate = { findFirst(args: unknown): Promise<unknown>; count(args: unknown): Promise<number> };
const delegateOf = (user: AccessUser, model: string, tx?: Db): Delegate => {
  const name = model.charAt(0).toLowerCase() + model.slice(1);
  const d = ((tx ?? getScopedDb(user.schoolId, user.id)) as unknown as Record<string, Delegate | undefined>)[name];
  if (!d) throw new Error(`inScope: unknown model "${model}"`);
  return d;
};

/** Role names that hold a key in the standard set-up, for "ask the Bursar or the Head". */
export async function whoCanDo(key: string): Promise<string[]> {
  const { ROLES, expandGrants } = await import('@/prisma/seed/access');
  return ROLES.filter((r) => !r.copiedFrom && expandGrants(r).has(key)).map((r) => r.name);
}

const label = (key: string) => (PERMISSIONS as Record<string, string>)[key] ?? key;
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

/** The refusal for a key the person does not hold, in plain words with who can do it instead. */
export async function missingPermission(user: AccessUser, key: string): Promise<AccessError> {
  const mod = moduleOf(key);
  const moduleName = MODULES.find((m) => m.key === mod)?.label ?? mod;
  if (user.disabledModules?.includes(mod)) return new AccessError(`${moduleName} is switched off for your school.`, 403, 'MODULE_OFF', key);
  if (user.readOnly && !LOOKING_ACTIONS.has(key.split('.')[2] ?? '')) {
    return new AccessError(user.support ? 'Pfuma support can look but not change anything.' : 'Your school’s subscription is suspended. You can look at records but not change them.', 403, 'READ_ONLY', key);
  }
  if (user.denied?.includes(key)) return new AccessError(`An exception on your account stops you from this: ${label(key).toLowerCase()}. Ask your administrator.`, 403, 'MISSING_PERMISSION', key);
  const who = await whoCanDo(key).catch(() => []);
  const ask = who.length ? ` Ask ${list(who.slice(0, 3).map((w) => `the ${w}`))}, or request access.` : ' Request access from your administrator.';
  return new AccessError(`You do not have permission to ${label(key).toLowerCase()}.${ask}`, 403, 'MISSING_PERMISSION', key);
}

/**
 * Is this record inside the scope of the person's grants of `key`? A record of another school, or one that does not exist, is "not found"
 * whatever the answer would otherwise be, so ids do not leak.
 */
export async function inScope(user: AccessUser, key: string, resource: Resource, tx?: Db): Promise<boolean> {
  const model = resource.model;
  const id = 'record' in resource ? resource.record.id : resource.id;
  if ('record' in resource && resource.record.schoolId !== undefined && resource.record.schoolId !== user.schoolId) throw notFound();
  const delegate = delegateOf(user, model, tx);
  // The school-scoped client only sees this school's rows, so another school's id looks like a missing one.
  if (!(await delegate.findFirst({ where: { id }, select: { id: true } }))) throw notFound();
  if (!grantsFor(effectiveOf(user), key).length) return false;
  return (await delegate.count({ where: { AND: [{ id }, await scopeWhere(user, key, model, tx)] } })) > 0;
}

export interface AllowOptions {
  /** Answer 404 instead of 403 when the record is outside the person's scope (the older convention for classes and students). */
  hideOutOfScope?: boolean;
  /** The caller's transaction, when it is inside one. */
  db?: Db;
}

/**
 * Checks 2 to 5 for a key and, when given, a record. Throws an AccessError with the reason. Refusals of a sensitive key are written
 * to the audit log, and ten of them in five minutes alert the administrators.
 */
export async function assertAllowed(user: AccessUser, key: string, resource?: Resource, opts: AllowOptions = {}): Promise<void> {
  if (!can(user, key)) {
    const err = await missingPermission(user, key);
    await recordDenied(user, key, err.message);
    throw err;
  }
  if (!resource) return;
  if (!(await inScope(user, key, resource, opts.db))) {
    const err = opts.hideOutOfScope
      ? notFound()
      : new AccessError('This record is outside what you are allowed to see: your access covers only your own classes, hostel, department or records.', 403, 'OUT_OF_SCOPE', key);
    await recordDenied(user, key, `out of scope: ${resource.model}`);
    throw err;
  }
}

/** A yes or no for a key on a record. Another school's record is still "not found" (it throws), as everywhere. */
export async function canAccess(user: AccessUser, key: string, resource: Resource): Promise<boolean> {
  if (!can(user, key)) return false;
  return inScope(user, key, resource);
}

// ─── Audit: refusals and sensitive reads ─────────────────────────────────────

const WINDOW_MS = 5 * 60_000;
export const DENIED_ALERT_AT = 10;
const sensitiveCache = new Map<string, boolean>();

async function isSensitive(key: string): Promise<boolean> {
  const hit = sensitiveCache.get(key);
  if (hit !== undefined) return hit;
  const row = await prisma.permission.findUnique({ where: { key }, select: { isSensitive: true } });
  sensitiveCache.set(key, !!row?.isSensitive);
  return !!row?.isSensitive;
}

/** Writes the refusal of a sensitive key to the audit log, and alerts the administrators at the tenth in five minutes. Never throws. */
export async function recordDenied(user: AccessUser, key: string, detail: string): Promise<void> {
  try {
    if (!(await isSensitive(key))) return;
    const db = getScopedDb(user.schoolId, user.id);
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'ACCESS_DENIED', entityType: 'Permission', entityId: key, detail: detail.slice(0, 300) }, db as never);
    const since = new Date(Date.now() - WINDOW_MS);
    const n = await db.auditLog.count({ where: { actorId: user.id, action: 'ACCESS_DENIED', createdAt: { gte: since } } });
    if (n < DENIED_ALERT_AT) return;
    const admins = await db.userRole.findMany({ where: { role: { key: 'ADMINISTRATOR' }, user: { active: true, isSupport: false } }, select: { userId: true } });
    const bucket = Math.floor(Date.now() / WINDOW_MS);
    await notify(admins.map((a) => a.userId), {
      type: 'ACCESS_DENIED_REPEATED', title: 'Repeated refused attempts',
      body: `Someone was refused ${n} times in five minutes on protected data (last: ${label(key).toLowerCase()}). See the audit log.`,
      link: '/system/audit-log', dedupeKey: `denied:${user.id}:${bucket}`,
    }, { schoolId: user.schoolId });
  } catch (e) {
    logger.warn('Could not record a refused access attempt', { key, error: e instanceof Error ? e.message : String(e) });
  }
}

/** A look at medical details, staff pay, someone else's payslip, or an export: Zimbabwe's Cyber and Data Protection Act expects it logged. */
export async function logSensitiveRead(
  user: AccessUser,
  kind: 'MEDICAL_VIEWED' | 'PAY_VIEWED' | 'EXPORT_DATA',
  entityType: string,
  entityId: string,
  detail?: string,
  db?: Parameters<typeof logAudit>[1],
): Promise<void> {
  await logAudit({ schoolId: user.schoolId, actorId: user.id, action: kind, entityType, entityId, detail }, db ?? (getScopedDb(user.schoolId, user.id) as never));
}

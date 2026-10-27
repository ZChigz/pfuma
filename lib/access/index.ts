// The access engine. Pages, menu items, buttons and API routes ask these; they never look at a role name.
//
//   can(user, key)                       does the person hold the key (module on, not denied, read-only respected)?  sync
//   canAccess(user, key, resource)       ... and is this record inside the scope of the grant?                      async
//   requirePermission(key, resource?)    for routes and actions: throws an AccessError with the reason (lib/access.ts)
//   scopeWhere(user, key, model)         the Prisma filter for a list, search or export
//   effectivePermissions(...)            roles + exceptions → how each key is held
//   guards.*                             the ten separation-of-duties rules
//   serialize*                           fields removed before a response leaves the server
//   moduleEnabled(schoolId, key)         is the module switched on? (cached for 60 seconds)
export { can, PERMISSIONS, type AccessUser, type PermissionKey } from '@/lib/access-core';
export { SCOPES, type Scope, type Grant, type Resource, type EffectivePermissions } from './types';
export { AccessError, notFound, type AccessErrorCode } from './errors';
export { effectivePermissions, grantsFor, heldKeys, permissionSummary, SINGLE_PERSON_FINANCE_KEYS } from './effective';
export { effectiveOf } from './user';
export * as scopes from './scopes';
export { reach, readableTermIds } from './scopes';
export { scopeWhere, registeredModels, MODEL_SCOPES } from './where';
export { assertAllowed, canAccess, inScope, missingPermission, recordDenied, logSensitiveRead, whoCanDo } from './check';
export * as guards from './guards';
export * from './serializers';
export { moduleEnabled, clearModuleCache } from './module';
export { requiredKeysFor, mayOpen, routeRules } from './routes';
export { bumpPermVersion, bumpHoldersOfRole } from './version';
export { uiPermissions } from './ui';

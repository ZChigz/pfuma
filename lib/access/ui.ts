// What the browser is told about the person's permissions, only to hide menu items and buttons. The server check is the one that counts.
import { can, PERMISSION_KEYS, type AccessUser } from '@/lib/access-core';
import { grantsFor } from './effective';
import { effectiveOf } from './user';
import type { Scope } from './types';

/** Key → the scopes it is held at, for every key the person may use right now (module on, not read-only for a change, not denied). */
export function uiPermissions(user: AccessUser): Record<string, Scope[]> {
  const eff = effectiveOf(user);
  const out: Record<string, Scope[]> = {};
  for (const key of PERMISSION_KEYS) {
    if (!can(user, key)) continue;
    const scopes = Array.from(new Set(grantsFor(eff, key).map((g) => g.scope)));
    out[key] = scopes.length ? scopes : ['SCHOOL'];
  }
  return out;
}

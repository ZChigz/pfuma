// What the engine needs to know about the person asking, and how to read it from the older flat list of keys.
import type { AccessUser } from '@/lib/access-core';
import type { EffectivePermissions, Grant } from './types';

const synthesized = new WeakMap<object, EffectivePermissions>();

/**
 * The person's effective permissions. A context built by loadContext carries them; one built from a bare list of keys (older call sites,
 * tests) holds each key school-wide, which is how that list has always been read.
 */
export function effectiveOf(user: AccessUser): EffectivePermissions {
  if (user.effective) return user.effective;
  let eff = synthesized.get(user);
  if (!eff) {
    const grants = new Map<string, Grant[]>();
    for (const k of user.grants ?? []) grants.set(k, [{ scope: 'SCHOOL' }]);
    eff = { grants, denied: new Set(user.denied ?? []), scopedDenies: new Map() };
    synthesized.set(user, eff);
  }
  return eff;
}

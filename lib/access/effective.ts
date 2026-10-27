// Effective permissions: the union of every role's grants (each at its own scope, narrowed by the pin of the assignment) plus the
// GRANT overrides that have not expired, minus the DENY overrides. A deny always beats a grant. Pure: the caller loads the rows.
import type { EffectivePermissions, Grant, GrantRow, OverrideRow, PinType, Scope } from './types';

/** The scope a role assignment pinned to a department, class, hostel or store narrows. */
const PIN_SCOPE: Record<Exclude<PinType, 'SCHOOL'>, Scope> = { DEPARTMENT: 'DEPARTMENT', CLASS: 'CLASS', HOSTEL: 'HOSTEL', STORE: 'STORE' };

/** Granted to the Owner so a school with one finance person has a second one (Settings, single-person finance). */
export const SINGLE_PERSON_FINANCE_KEYS = ['finance.payments.verify', 'finance.adjustments.approve'] as const;

const same = (a: Grant, b: Grant) => a.scope === b.scope && (a.scopeId ?? '') === (b.scopeId ?? '');

export interface EffectiveInput {
  /** Every grant of every role the person holds, with the pin of the assignment that brings it. */
  roleGrants: readonly GrantRow[];
  overrides?: readonly OverrideRow[];
  /** Keys of the roles held (OWNER ...), for the single-person-finance rule. */
  roleKeys?: readonly string[];
  singlePersonFinance?: boolean;
  now?: Date;
}

export function effectivePermissions(input: EffectiveInput): EffectivePermissions {
  const now = input.now ?? new Date();
  const grants = new Map<string, Grant[]>();
  const add = (key: string, g: Grant) => {
    const list = grants.get(key) ?? [];
    if (!list.some((x) => same(x, g))) list.push(g);
    grants.set(key, list);
  };

  for (const row of input.roleGrants) {
    // A role pinned to one department/class/hostel/store narrows its grants at that scope to the pinned place; its other grants are unchanged.
    const pinned = row.pinType && row.pinType !== 'SCHOOL' && row.pinId !== '' && PIN_SCOPE[row.pinType] === row.scope;
    add(row.key, pinned ? { scope: row.scope, scopeId: row.pinId } : { scope: row.scope });
  }

  const viaRule = new Set<string>();
  if (input.singlePersonFinance && input.roleKeys?.includes('OWNER')) {
    for (const k of SINGLE_PERSON_FINANCE_KEYS) {
      if (!grants.has(k)) viaRule.add(k);
      add(k, { scope: 'SCHOOL' });
    }
  }

  const live = (input.overrides ?? []).filter((o) => !o.revokedAt && o.expiresAt.getTime() > now.getTime());
  for (const o of live.filter((o) => o.effect === 'GRANT')) add(o.key, o.scopeId ? { scope: o.scope, scopeId: o.scopeId } : { scope: o.scope });

  const denied = new Set<string>();
  const scopedDenies = new Map<string, Grant[]>();
  for (const o of live.filter((o) => o.effect === 'DENY')) {
    if (o.scope === 'SCHOOL') {
      denied.add(o.key);
      grants.delete(o.key);
      continue;
    }
    const d: Grant = o.scopeId ? { scope: o.scope, scopeId: o.scopeId } : { scope: o.scope };
    scopedDenies.set(o.key, [...(scopedDenies.get(o.key) ?? []), d]);
    // The grants of that scope go (all of them, or the pinned one the deny names).
    const left = (grants.get(o.key) ?? []).filter((g) => !(g.scope === d.scope && (!d.scopeId || g.scopeId === d.scopeId)));
    if (left.length) grants.set(o.key, left);
    else grants.delete(o.key);
  }
  return { grants, denied, scopedDenies, ...(viaRule.size ? { viaRule } : {}) };
}

/** The ways a person holds a key. */
export function grantsFor(eff: EffectivePermissions, key: string): Grant[] {
  if (eff.denied.has(key)) return [];
  return eff.grants.get(key) ?? [];
}

/** Every key held at any scope, with the wildcard as itself, minus what is denied. For the older flat check and for the menu. */
export function heldKeys(eff: EffectivePermissions): string[] {
  return Array.from(eff.grants.keys()).filter((k) => !eff.denied.has(k));
}

/** How a person holds each key, shaped for the browser: key → scopes. */
export function permissionSummary(eff: EffectivePermissions, catalogue: readonly string[]): Record<string, Scope[]> {
  const out: Record<string, Scope[]> = {};
  for (const key of catalogue) {
    const g = grantsFor(eff, key);
    if (g.length) out[key] = Array.from(new Set(g.map((x) => x.scope)));
  }
  return out;
}

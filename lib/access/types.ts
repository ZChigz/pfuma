// Shared types of the access engine. No database or framework imports, so tests, server code and client code can all use them.

/** How far a grant reaches (docs: Pfuma Access Control, Scopes). CHILDREN is reserved for the parent portal and never resolves. */
export const SCOPES = ['SCHOOL', 'DEPARTMENT', 'CLASS', 'ASSIGNED', 'HOSTEL', 'STORE', 'RECORDED_BY_ME', 'SELF', 'CHILDREN'] as const;
export type Scope = (typeof SCOPES)[number];

/** How wide a scope reaches: a smaller number is wider. Two scopes of the same width are different places, not wider or narrower. */
export const SCOPE_WIDTH: Record<Scope, number> = { SCHOOL: 0, DEPARTMENT: 1, CLASS: 2, ASSIGNED: 2, HOSTEL: 2, STORE: 2, RECORDED_BY_ME: 3, SELF: 4, CHILDREN: 5 };

/** Whether `next` is the same as `source` or strictly narrower (a custom role may narrow a copied grant, never widen it). */
export const narrowsOrEquals = (source: Scope, next: Scope): boolean => next === source || SCOPE_WIDTH[next] > SCOPE_WIDTH[source];

/** The scopes a role can be pinned to on one person (UserRole.scopeType). */
export type PinType = 'SCHOOL' | 'DEPARTMENT' | 'CLASS' | 'HOSTEL' | 'STORE';

/** One way a person holds a key: at a scope, optionally narrowed to one department, class, hostel or store. */
export interface Grant {
  scope: Scope;
  /** Set when a role is pinned (Mr Chikore is HOD of Sciences) or an override names one place. */
  scopeId?: string;
}

/** A key a role grants, with the pin of the UserRole row that brings it. */
export interface GrantRow {
  key: string;
  scope: Scope;
  pinType: PinType | null;
  pinId: string;
}

export interface OverrideRow {
  key: string;
  scope: Scope;
  scopeId: string;
  effect: 'GRANT' | 'DENY';
  expiresAt: Date;
  revokedAt: Date | null;
}

/** What a person may do, worked out from their roles and exceptions. */
export interface EffectivePermissions {
  /** Key (or "*") → the ways it is held. */
  grants: Map<string, Grant[]>;
  /** Keys refused outright by a school-wide DENY override. They beat every grant, "*" included. */
  denied: Set<string>;
  /** DENY overrides that name a scope: they remove matching grants and ids from that scope, never a school-wide grant. */
  scopedDenies: Map<string, Grant[]>;
  /** Keys held only because of the single-person-finance rule (the Owner covering for a missing second finance person), not by any role. */
  viaRule?: Set<string>;
}

/** The record a check is about: loaded already, or named so the engine can load it. */
export type Resource =
  | { model: string; id: string }
  | { model: string; record: { id: string; schoolId?: string } & Record<string, unknown> };

export const LOOKING_ACTIONS: ReadonlySet<string> = new Set(['view', 'export']);

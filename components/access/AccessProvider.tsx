'use client';
// The person's permissions in the browser, to hide what they cannot use: menu items, buttons, tabs. Hiding is a courtesy; every
// action is checked again on the server.
//
//   const mayVerify = useCan('finance.payments.verify');
//   <Can permission="finance.payments.void"><VoidButton /></Can>
//   <Can anyOf={['hr.pay.view', 'hr.payroll.view']}>...</Can>
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Scope } from '@/lib/access/types';

type Permissions = Record<string, Scope[]>;
const AccessContext = createContext<Permissions>({});
const RolesContext = createContext<string[]>([]);

export function AccessProvider({ permissions, roles = [], children }: { permissions: Permissions; roles?: string[]; children: ReactNode }) {
  const value = useMemo(() => permissions, [permissions]);
  return (
    <AccessContext.Provider value={value}>
      <RolesContext.Provider value={roles}>{children}</RolesContext.Provider>
    </AccessContext.Provider>
  );
}

/** The names of the roles the person holds, for the access-denied page. */
export function useRoles(): string[] {
  return useContext(RolesContext);
}

/** True when the person holds the key (at any scope). */
export function useCan(key: string): boolean {
  return key in useContext(AccessContext);
}

/** The scopes the key is held at; empty when it is not held. */
export function useScopes(key: string): Scope[] {
  return useContext(AccessContext)[key] ?? [];
}

/** Shows its children only to someone who holds the permission (or any of `anyOf`). Hidden, not disabled. */
export function Can({ permission, anyOf, children, fallback = null }: { permission?: string; anyOf?: string[]; children: ReactNode; fallback?: ReactNode }) {
  const held = useContext(AccessContext);
  const keys = [...(permission ? [permission] : []), ...(anyOf ?? [])];
  return keys.some((k) => k in held) ? <>{children}</> : <>{fallback}</>;
}

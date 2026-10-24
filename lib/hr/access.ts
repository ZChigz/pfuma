// The same as getAccess() for HR pages, except that can() applies the rule for personal and pay data: "*" alone does not open it
// (lib/hr/common.ts, RESTRICTED_KEYS). Pages use this so the menu, the buttons and the page agree with what the services will allow.
import { getAccess, type AccessContext } from '@/lib/access';
import type { PermissionKey } from '@/lib/access-core';
import { hrHolds } from '@/lib/hr/common';

export async function getHrAccess(): Promise<{ user: AccessContext; can: (permission: PermissionKey) => boolean }> {
  const { user } = await getAccess();
  return { user, can: (permission) => hrHolds(user, permission) };
}

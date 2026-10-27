// permVersion: moves whenever a person's roles, exceptions or status change, or the grants of a role they hold. Anything that changes
// who may do what calls one of these in the same transaction as the change, so a removed permission stops working on the next request
// (and the browser's copy is replaced) without waiting for the person to sign out.
import type { Db } from '@/lib/scoped-db';

/** Moves the version of these people. */
export async function bumpPermVersion(tx: Db, userIds: readonly string[]): Promise<void> {
  const ids = Array.from(new Set(userIds));
  if (!ids.length) return;
  await tx.user.updateMany({ where: { id: { in: ids } }, data: { permVersion: { increment: 1 } } });
}

/** A role's grants changed: everyone who holds the role is affected. */
export async function bumpHoldersOfRole(tx: Db, roleId: string): Promise<number> {
  const holders = await tx.userRole.findMany({ where: { roleId }, select: { userId: true } });
  await bumpPermVersion(tx, holders.map((h) => h.userId));
  return new Set(holders.map((h) => h.userId)).size;
}

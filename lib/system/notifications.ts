// In-app notifications. Always written inside the transaction of the change that
// caused them, so a rolled-back change leaves no notification behind.
import type { Role } from '@prisma/client';
import type { Db } from '@/lib/scoped-db';
import { FULL_ACCESS_ROLES } from '@/lib/access-core';

export interface NotificationInput {
  title: string;
  body?: string;
  href?: string;
}

export async function notifyUsers(tx: Db, schoolId: string, userIds: string[], n: NotificationInput) {
  const ids = Array.from(new Set(userIds));
  if (ids.length === 0) return;
  await tx.notification.createMany({
    data: ids.map((userId) => ({ schoolId, userId, title: n.title, body: n.body ?? null, href: n.href ?? null })),
  });
}

/** Tells every active administrator / owner of the school, except the person who did it. */
export async function notifyAdmins(tx: Db, schoolId: string, exceptUserId: string, n: NotificationInput) {
  const admins = await tx.user.findMany({
    where: { active: true, role: { in: FULL_ACCESS_ROLES as unknown as Role[] }, id: { not: exceptUserId } },
    select: { id: true },
  });
  await notifyUsers(tx, schoolId, admins.map((a) => a.id), n);
}

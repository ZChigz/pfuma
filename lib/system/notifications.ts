// In-app notifications. Always written inside the transaction of the change that
// caused them when there is one, so a rolled-back change leaves no notification behind.
import { prisma } from '@/lib/prisma';
import type { Db } from '@/lib/scoped-db';

export interface NotificationInput {
  /** What kind of notice (WELCOME, ROLES_CHANGED, TERM_OPENS_TOMORROW ...). */
  type?: string;
  title: string;
  body?: string;
  link?: string;
  /**
   * Sending the same notice twice does nothing: one per person per key. Use it for anything a
   * schedule can run again (for example "term-opens:<termId>").
   */
  dedupeKey?: string;
}

/** Writes the notice for each person. Returns how many were new. */
export async function notifyUsers(tx: Db, schoolId: string, userIds: string[], n: NotificationInput): Promise<number> {
  const ids = Array.from(new Set(userIds));
  if (ids.length === 0) return 0;
  const result = await tx.notification.createMany({
    data: ids.map((userId) => ({ schoolId, userId, type: n.type ?? 'GENERAL', title: n.title, body: n.body ?? null, link: n.link ?? null, dedupeKey: n.dedupeKey ?? null })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * The one way every module sends a notification: notify(userIds, payload).
 * Inside a transaction pass it as `tx` so the notice commits or rolls back with the change.
 * Without one the people's schools are looked up and the notice is written on its own.
 */
export async function notify(userIds: string[], payload: NotificationInput, opts: { tx?: Db; schoolId?: string } = {}): Promise<number> {
  const ids = Array.from(new Set(userIds));
  if (ids.length === 0) return 0;
  if (opts.tx && opts.schoolId) return notifyUsers(opts.tx, opts.schoolId, ids, payload);

  const people = await prisma.user.findMany({ where: { id: { in: ids }, isSupport: false }, select: { id: true, schoolId: true } });
  let count = 0;
  const bySchool = new Map<string, string[]>();
  for (const p of people) bySchool.set(p.schoolId, [...(bySchool.get(p.schoolId) ?? []), p.id]);
  for (const [schoolId, list] of Array.from(bySchool)) {
    const r = await prisma.notification.createMany({
      data: list.map((userId) => ({ schoolId, userId, type: payload.type ?? 'GENERAL', title: payload.title, body: payload.body ?? null, link: payload.link ?? null, dedupeKey: payload.dedupeKey ?? null })),
      skipDuplicates: true,
    });
    count += r.count;
  }
  return count;
}

/** The active people who hold the Owner or Administrator role, optionally leaving one person out. */
export async function adminIds(tx: Db, schoolId: string, exceptUserId?: string): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: {
      schoolId, active: true, isSupport: false, ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
      userRoles: { some: { role: { key: { in: ['OWNER', 'ADMINISTRATOR'] } } } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Tells every active administrator / owner of the school, except the person who did it. */
export async function notifyAdmins(tx: Db, schoolId: string, exceptUserId: string, n: NotificationInput) {
  await notifyUsers(tx, schoolId, await adminIds(tx, schoolId, exceptUserId), n);
}

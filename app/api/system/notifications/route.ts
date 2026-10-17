import { requirePermission } from '@/lib/access';
import { apiNotFound, apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { NotificationReadSchema } from '@/lib/validations/system';

// A person's own notifications only. Marking one read is personal housekeeping, not a
// school record, so it is not written to the audit log.
async function _GET(req: Request) {
  const user = await requirePermission('account.notifications.view');
  const db = getScopedDb(user.schoolId, user.id);
  const limit = Math.min(50, Math.max(1, Number(new URL(req.url).searchParams.get('limit')) || 10));
  const [unread, items] = await Promise.all([
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.notification.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { id: true, title: true, body: true, link: true, type: true, readAt: true, createdAt: true },
    }),
  ]);
  return apiSuccess({ unread, items });
}

async function _POST(req: Request) {
  const user = await requirePermission('account.notifications.view');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, NotificationReadSchema);
  if ('error' in parsed) return parsed.error;

  const now = new Date();
  if ('all' in parsed.data) {
    const r = await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: now } });
    return apiSuccess({ marked: r.count });
  }
  const r = await db.notification.updateMany({ where: { id: parsed.data.id, userId: user.id, readAt: null }, data: { readAt: now } });
  if (r.count === 0 && !(await db.notification.findFirst({ where: { id: parsed.data.id, userId: user.id }, select: { id: true } }))) {
    return apiNotFound('Notification');
  }
  return apiSuccess({ marked: r.count });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/notifications', _GET as H);
export const POST = withApi('POST /api/system/notifications', _POST as H);

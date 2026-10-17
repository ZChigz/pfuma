import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { deleteEvent, updateEvent } from '@/lib/system/calendar';
import { CalendarEventUpdateSchema } from '@/lib/validations/system';

// Editing or deleting a repeating event changes the whole series.
async function _PATCH(req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.calendar.edit');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, CalendarEventUpdateSchema);
  if ('error' in parsed) return parsed.error;
  const { acknowledged, ...input } = parsed.data;
  const result = await updateEvent(db, user, ctx.params.id, input, acknowledged === true);
  if (!result.saved) {
    return NextResponse.json({ success: false, message: 'Please confirm', needsConfirmation: true, warnings: result.warnings }, { status: 409 });
  }
  return apiSuccess({ event: result.event });
}

async function _DELETE(_req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.calendar.delete');
  const db = getScopedDb(user.schoolId, user.id);
  await deleteEvent(db, user, ctx.params.id);
  return apiSuccess({ deleted: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/system/calendar/[id]', _PATCH as H);
export const DELETE = withApi('DELETE /api/system/calendar/[id]', _DELETE as H);

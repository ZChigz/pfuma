import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/access';
import { apiError, apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { createEvent, listCalendar } from '@/lib/system/calendar';
import { CalendarEventSchema, CalendarRangeSchema } from '@/lib/validations/system';

async function _GET(req: Request) {
  const user = await requirePermission('system.calendar.view');
  const db = getScopedDb(user.schoolId, user.id);
  const sp = new URL(req.url).searchParams;
  const range = CalendarRangeSchema.safeParse({ from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined, type: sp.get('type') ?? undefined });
  if (!range.success) return apiError('Use dates in the form YYYY-MM-DD and a known event type', 422);
  const year = new Date().getUTCFullYear();
  const from = range.data.from ?? `${year}-01-01`;
  const to = range.data.to ?? `${year}-12-31`;
  if (to < from) return apiError('The end date cannot be before the start date', 422);
  if (Date.parse(to) - Date.parse(from) > 400 * 864e5) return apiError('Ask for at most 400 days at a time', 422);
  return apiSuccess({ items: await listCalendar(db, user, from, to, { type: range.data.type }) });
}

async function _POST(req: Request) {
  const user = await requirePermission('system.calendar.create');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, CalendarEventSchema);
  if ('error' in parsed) return parsed.error;
  const { acknowledged, ...input } = parsed.data;
  const result = await createEvent(db, user, input, acknowledged === true);
  if (!result.saved) {
    return NextResponse.json({ success: false, message: 'Please confirm', needsConfirmation: true, warnings: result.warnings }, { status: 409 });
  }
  return apiSuccess({ event: result.event }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/calendar', _GET as H);
export const POST = withApi('POST /api/system/calendar', _POST as H);

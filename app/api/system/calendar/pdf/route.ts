import { createElement } from 'react';
import { renderToStream } from '@react-pdf/renderer';
import { requirePermission } from '@/lib/access';
import { apiError, apiNotFound, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { CalendarPdf } from '@/components/system/CalendarPdf';
import { listCalendar } from '@/lib/system/calendar';

export const runtime = 'nodejs';

// The term's calendar as a PDF for the staff-room notice board: term dates, public
// holidays and events (repeats worked out) that fall inside the term.
async function _GET(req: Request) {
  const user = await requirePermission('system.calendar.export');
  const db = getScopedDb(user.schoolId, user.id);
  const termId = new URL(req.url).searchParams.get('termId');
  if (!termId) return apiError('termId is required', 400);

  const term = await db.academicTerm.findFirst({ where: { id: termId, schoolId: user.schoolId } });
  if (!term) return apiNotFound('Term');
  const [school] = await Promise.all([db.school.findUnique({ where: { id: user.schoolId }, select: { name: true } })]);

  const start = term.startDate.toISOString().slice(0, 10);
  const end = term.endDate.toISOString().slice(0, 10);
  const items = await listCalendar(db, user, start, end);

  const stream = await renderToStream(
    createElement(CalendarPdf, {
      data: { schoolName: school?.name ?? '', termName: term.name, termStart: start, termEnd: end, items, printedOn: new Date().toISOString().slice(0, 10) },
    }) as never,
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      stream.on('end', () => controller.close());
      stream.on('error', (err: Error) => controller.error(err));
    },
    cancel() {
      (stream as unknown as { destroy?: () => void }).destroy?.();
    },
  });
  const safe = term.name.replace(/[^a-zA-Z0-9]/g, '-');
  return new Response(body, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="calendar-${safe}.pdf"`, 'Cache-Control': 'no-store' },
  });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/calendar/pdf', _GET as H);

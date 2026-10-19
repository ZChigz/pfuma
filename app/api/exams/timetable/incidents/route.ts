import { guarded, body } from '@/lib/exams/route';
import { listIncidents, reportIncident } from '@/lib/exams/invigilation';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/timetable/incidents', ['exams.invigilation.manage', 'exams.timetable.manage', 'exams.timetable.approve'], async ({ user, query }) => listIncidents(user, query.get('periodId') ?? ''));
export const POST = guarded('POST /api/exams/timetable/incidents', ['exams.invigilation.manage', 'exams.timetable.manage', 'exams.marks.enter'], async ({ user, req }) => reportIncident(user, await body(req)), 201);

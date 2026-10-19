import { guarded, body } from '@/lib/exams/route';
import { listPeriods, savePeriod } from '@/lib/exams/timetable';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/timetable/periods', ['exams.timetable.manage', 'exams.timetable.approve', 'exams.invigilation.manage', 'exams.marks.enter'], async ({ user, query }) => listPeriods(user, query.get('termId') ?? undefined));
export const POST = guarded('POST /api/exams/timetable/periods', 'exams.timetable.manage', async ({ user, req }) => savePeriod(user, await body(req)), 201);

import { guarded, body } from '@/lib/exams/route';
import { assignInvigilator } from '@/lib/exams/invigilation';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/timetable/invigilation', ['exams.invigilation.manage', 'exams.timetable.manage'], async ({ user, req }) => assignInvigilator(user, await body(req)), 201);

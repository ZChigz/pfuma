import { guarded, body } from '@/lib/exams/route';
import { savePaper } from '@/lib/exams/timetable';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/timetable/papers', 'exams.timetable.manage', async ({ user, req }) => savePaper(user, await body(req)), 201);

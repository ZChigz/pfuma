import { guarded, body } from '@/lib/exams/route';
import { savePaper, deletePaper } from '@/lib/exams/timetable';

export const runtime = 'nodejs';

export const PATCH = guarded('PATCH /api/exams/timetable/papers/[id]', 'exams.timetable.manage', async ({ user, req, params }) => savePaper(user, await body(req), params.id!));
export const DELETE = guarded('DELETE /api/exams/timetable/papers/[id]', 'exams.timetable.manage', async ({ user, params }) => deletePaper(user, params.id!));

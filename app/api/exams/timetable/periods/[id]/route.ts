import { guarded, body } from '@/lib/exams/route';
import { getPeriod, savePeriod, deletePeriod } from '@/lib/exams/timetable';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/timetable/periods/[id]', ['exams.timetable.manage', 'exams.timetable.approve', 'exams.invigilation.manage', 'exams.marks.enter'], async ({ user, params }) => getPeriod(user, params.id!));
export const PATCH = guarded('PATCH /api/exams/timetable/periods/[id]', 'exams.timetable.manage', async ({ user, req, params }) => savePeriod(user, await body(req), params.id!));
export const DELETE = guarded('DELETE /api/exams/timetable/periods/[id]', 'exams.timetable.manage', async ({ user, params }) => deletePeriod(user, params.id!));

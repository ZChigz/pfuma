import { guarded } from '@/lib/exams/route';
import { removeInvigilator } from '@/lib/exams/invigilation';

export const runtime = 'nodejs';

export const DELETE = guarded('DELETE /api/exams/timetable/invigilation/[id]', ['exams.invigilation.manage', 'exams.timetable.manage'], async ({ user, params }) => removeInvigilator(user, params.id!));

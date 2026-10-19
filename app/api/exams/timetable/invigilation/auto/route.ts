import { guarded, body } from '@/lib/exams/route';
import { autoAssignInvigilators } from '@/lib/exams/invigilation';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/timetable/invigilation/auto', ['exams.invigilation.manage', 'exams.timetable.manage'], async ({ user, req }) => autoAssignInvigilators(user, await body(req)));

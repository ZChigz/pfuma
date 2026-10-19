import { guarded } from '@/lib/exams/route';
import { submitPeriod } from '@/lib/exams/timetable';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/timetable/periods/[id]/submit', 'exams.timetable.manage', async ({ user, params }) => submitPeriod(user, params.id!));

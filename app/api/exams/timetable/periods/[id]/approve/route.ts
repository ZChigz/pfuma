import { guarded } from '@/lib/exams/route';
import { approvePeriod } from '@/lib/exams/timetable';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/timetable/periods/[id]/approve', 'exams.timetable.approve', async ({ user, params }) => approvePeriod(user, params.id!));

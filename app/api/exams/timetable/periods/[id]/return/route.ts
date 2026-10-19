import { guarded, body } from '@/lib/exams/route';
import { returnPeriod } from '@/lib/exams/timetable';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/timetable/periods/[id]/return', 'exams.timetable.approve', async ({ user, req, params }) => returnPeriod(user, params.id!, await body(req)));

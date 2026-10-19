import { guarded, body } from '@/lib/exams/route';
import { setPaperRooms } from '@/lib/exams/timetable';

export const runtime = 'nodejs';

export const PUT = guarded('PUT /api/exams/timetable/papers/[id]/rooms', 'exams.timetable.manage', async ({ user, req, params }) => setPaperRooms(user, params.id!, await body(req)));

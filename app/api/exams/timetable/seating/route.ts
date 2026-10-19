import { guarded } from '@/lib/exams/route';
import { seatingFor } from '@/lib/exams/invigilation';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/timetable/seating', ['exams.invigilation.manage', 'exams.timetable.manage', 'exams.timetable.approve', 'exams.marks.enter'], async ({ user, query }) => seatingFor(user, query.get('paperId') ?? ''));

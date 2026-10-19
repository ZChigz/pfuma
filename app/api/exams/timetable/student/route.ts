import { guarded } from '@/lib/exams/route';
import { studentTimetable } from '@/lib/exams/timetable';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/timetable/student', ['exams.timetable.manage', 'exams.timetable.approve', 'exams.invigilation.manage', 'exams.results.view'], async ({ user, query }) => studentTimetable(user, query.get('periodId') ?? '', query.get('studentId') ?? ''));

import { guarded, body } from '@/lib/exams/route';
import { attendanceSheet, markAttendance } from '@/lib/exams/invigilation';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/timetable/attendance', ['exams.invigilation.manage', 'exams.timetable.manage', 'exams.timetable.approve', 'exams.marks.enter'], async ({ user, query }) => attendanceSheet(user, query.get('paperId') ?? '', query.get('roomId') ?? ''));
export const PUT = guarded('PUT /api/exams/timetable/attendance', ['exams.invigilation.manage', 'exams.timetable.manage', 'exams.marks.enter'], async ({ user, req }) => markAttendance(user, await body(req)));

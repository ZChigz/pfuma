import { guarded } from '@/lib/exams/route';
import { dutyRoster, myDuties } from '@/lib/exams/invigilation';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/timetable/duties', ['exams.invigilation.manage', 'exams.timetable.manage', 'exams.timetable.approve', 'exams.marks.enter'], async ({ user, query }) => query.get('periodId') ? dutyRoster(user, query.get('periodId')!) : myDuties(user, { upcomingOnly: query.get('upcoming') === '1' }));

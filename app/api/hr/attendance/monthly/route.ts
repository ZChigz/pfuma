// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as att from '@/lib/hr/attendance';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/attendance/monthly', ["hr.attendance.view"], async ({ user, query }) => att.monthlyAttendance(user, query.get("month") || ""));

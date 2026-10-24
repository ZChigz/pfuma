// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as att from '@/lib/hr/attendance';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/attendance/summary', ["hr.attendance.view","hr.attendance.mark"], async ({ user, query }) => att.dailySummary(user, query.get("date") || undefined));

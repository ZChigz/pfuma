// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as att from '@/lib/hr/attendance';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/attendance/trend', ["hr.attendance.view"], async ({ user, query }) => att.latenessTrend(user, { from: query.get("from") || "", to: query.get("to") || "" }));

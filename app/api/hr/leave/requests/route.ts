// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as leave from '@/lib/hr/leave';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/leave/requests', ["hr.self.leave","hr.leave.view_all","hr.leave.approve"], async ({ user, query }) => leave.listLeaveRequests(user, Object.fromEntries(query)));
export const POST = guarded('POST /api/hr/leave/requests', ["hr.leave.request"], async ({ user, req }) => leave.requestLeave(user, await body(req)), 201);

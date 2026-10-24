// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as leave from '@/lib/hr/leave';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/leave/types', ["hr.leave.request","hr.leave.view_all","hr.leave.adjust"], async ({ user }) => leave.listLeaveTypes(user));
export const POST = guarded('POST /api/hr/leave/types', ["hr.leave.adjust"], async ({ user, req }) => leave.saveLeaveType(user, await body(req)));

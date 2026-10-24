// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as leave from '@/lib/hr/leave';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/hr/leave/requests/[id]/cancel', ["hr.self.leave","hr.leave.approve"], async ({ user, req, params }) => leave.cancelLeave(user, params.id!, await body(req).catch(() => ({}))));

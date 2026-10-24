// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as leave from '@/lib/hr/leave';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/leave/colleagues', ["hr.leave.request","hr.self.details"], async ({ user }) => leave.listColleagues(user));

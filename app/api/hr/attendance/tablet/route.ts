// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as att from '@/lib/hr/attendance';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/hr/attendance/tablet', ["hr.attendance.mark"], async ({ user, req }) => att.tabletSignIn(user, await body(req)));

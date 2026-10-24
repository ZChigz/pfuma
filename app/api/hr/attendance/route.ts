// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as att from '@/lib/hr/attendance';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/attendance', ["hr.attendance.mark","hr.attendance.view"], async ({ user, query }) => att.getRegister(user, query.get("date") || undefined));
export const POST = guarded('POST /api/hr/attendance', ["hr.attendance.mark","hr.attendance.correct"], async ({ user, req }) => att.markRegister(user, await body(req)));

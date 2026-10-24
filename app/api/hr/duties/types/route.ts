// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as duties from '@/lib/hr/duties';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/duties/types', ["hr.duties.view","hr.duties.manage","hr.duties.approve"], async ({ user }) => duties.listDutyTypes(user));
export const POST = guarded('POST /api/hr/duties/types', ["hr.duties.manage"], async ({ user, req }) => duties.saveDutyType(user, await body(req)));

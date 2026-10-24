// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as rec from '@/lib/hr/recruitment';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/hr/government-teachers', ["hr.employees.manage"], async ({ user, req }) => rec.addGovernmentTeacher(user, await body(req)), 201);

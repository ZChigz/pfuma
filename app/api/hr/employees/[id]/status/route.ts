// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as emp from '@/lib/hr/employees';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/hr/employees/[id]/status', ["hr.employees.manage"], async ({ user, req, params }) => emp.setEmployeeStatus(user, params.id!, await body(req)));

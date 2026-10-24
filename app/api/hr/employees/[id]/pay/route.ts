// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as emp from '@/lib/hr/employees';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/employees/[id]/pay', ["hr.pay.view","hr.self.details","hr.self.leave","hr.self.payslips"], async ({ user, params }) => emp.getPay(user, params.id!));
export const PUT = guarded('PUT /api/hr/employees/[id]/pay', ["hr.pay.manage"], async ({ user, req, params }) => emp.setPay(user, params.id!, await body(req)));

// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as emp from '@/lib/hr/employees';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/employees/[id]', ["hr.directory.view","hr.employees.view","hr.self.details","hr.self.leave","hr.self.payslips"], async ({ user, params }) => emp.getEmployee(user, params.id!));
export const PATCH = guarded('PATCH /api/hr/employees/[id]', ["hr.employees.manage"], async ({ user, req, params }) => emp.updateEmployee(user, params.id!, await body(req)));

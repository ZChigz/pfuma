// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as emp from '@/lib/hr/employees';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/employees', ["hr.directory.view","hr.employees.view"], async ({ user, query }) => emp.listDirectory(user, Object.fromEntries(query)));
export const POST = guarded('POST /api/hr/employees', ["hr.employees.manage"], async ({ user, req }) => emp.createEmployee(user, await body(req)), 201);

// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as rec from '@/lib/hr/recruitment';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/contracts', ["hr.contracts.manage","hr.employees.view"], async ({ user, query }) => rec.listContracts(user, query.get("employeeId") || undefined));
export const POST = guarded('POST /api/hr/contracts', ["hr.contracts.manage"], async ({ user, req }) => rec.createContract(user, await body(req)), 201);

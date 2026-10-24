// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as run from '@/lib/payroll/run';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/payroll/runs', ["hr.payroll.view","hr.payroll.prepare","hr.payroll.approve"], async ({ user }) => run.listRuns(user));
export const POST = guarded('POST /api/hr/payroll/runs', ["hr.payroll.prepare"], async ({ user, req }) => run.createRun(user, await body(req)), 201);

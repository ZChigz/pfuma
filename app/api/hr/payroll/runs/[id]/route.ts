// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as run from '@/lib/payroll/run';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/payroll/runs/[id]', ["hr.payroll.view","hr.payroll.prepare","hr.payroll.approve"], async ({ user, params }) => run.getRun(user, params.id!));

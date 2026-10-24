// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as run from '@/lib/payroll/run';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/hr/payroll/runs/[id]/approve', ["hr.payroll.approve"], async ({ user, params }) => run.approveRun(user, params.id!));

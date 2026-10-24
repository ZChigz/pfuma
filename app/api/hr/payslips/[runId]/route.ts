// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as slip from '@/lib/payroll/payslip';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/payslips/[runId]', ["hr.self.payslips","hr.payroll.view"], async ({ user, params, query }) => slip.getPayslip(user, params.runId!, query.get("employeeId") || undefined));

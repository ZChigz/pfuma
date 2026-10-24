// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as pset from '@/lib/payroll/settings-service';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/payroll/settings', ["hr.payroll.settings","hr.payroll.view","hr.payroll.prepare"], async ({ user }) => pset.getPayrollSettings(user));

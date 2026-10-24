// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as pset from '@/lib/payroll/settings-service';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/hr/payroll/settings/confirm', ["hr.payroll.settings"], async ({ user, req }) => pset.confirmSetting(user, await body(req)));

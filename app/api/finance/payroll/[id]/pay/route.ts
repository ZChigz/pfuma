// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as payroll from '@/lib/finance/payroll';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/payroll/[id]/pay', 'finance.payroll.pay', async ({ user, req, params }) => payroll.markPayrollPaid(user, params.id, await body(req)));

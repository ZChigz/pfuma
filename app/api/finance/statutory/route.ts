// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as payroll from '@/lib/finance/payroll';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/statutory', ['finance.payroll.pay', 'finance.dashboard.view'], async ({ user }) => payroll.statutoryDue(user));

// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as setup from '@/lib/finance/setup';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/funds', ['finance.fees.view', 'finance.accounts.view', 'finance.payments.record', 'finance.payments.view', 'finance.expenses.view', 'finance.requests.view', 'finance.requests.create', 'finance.reports.view', 'finance.funds.manage'], async ({ user }) => setup.listFunds(user));
export const POST = guarded('POST /api/finance/funds', 'finance.funds.manage', async ({ user, req }) => setup.createFund(user, await body(req)), 201);

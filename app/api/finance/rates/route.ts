// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as rates from '@/lib/finance/rates';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/rates', ['finance.rates.view', 'finance.rates.manage', 'finance.dashboard.view', 'finance.payments.record'], async ({ user }) => rates.listRates(user));
export const POST = guarded('POST /api/finance/rates', 'finance.rates.manage', async ({ user, req }) => rates.setRate(user, await body(req)), 201);

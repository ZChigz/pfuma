// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as setup from '@/lib/finance/setup';

export const runtime = 'nodejs';

export const PATCH = guarded('PATCH /api/finance/funds/[id]', 'finance.funds.manage', async ({ user, req, params }) => setup.updateFund(user, params.id, await body(req)));

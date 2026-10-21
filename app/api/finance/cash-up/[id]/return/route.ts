// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as cashup from '@/lib/finance/cashup';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/cash-up/[id]/return', ['finance.cashup.confirm', 'finance.cashup.signoff'], async ({ user, req, params }) => (async () => { const b = (await body(req)) as { reason?: unknown }; return cashup.returnCashUp(user, params.id, b.reason); })());

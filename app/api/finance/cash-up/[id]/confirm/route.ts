// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as cashup from '@/lib/finance/cashup';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/cash-up/[id]/confirm', 'finance.cashup.confirm', async ({ user, req, params }) => cashup.confirmCashUp(user, params.id, await body(req).catch(() => undefined)));

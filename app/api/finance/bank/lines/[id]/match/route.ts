// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as bank from '@/lib/finance/bank';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/bank/lines/[id]/match', 'finance.bank.reconcile', async ({ user, req, params }) => (async () => { const b = (await body(req)) as { paymentId?: string }; return bank.matchLineTo(user, params.id, b.paymentId ?? ''); })());

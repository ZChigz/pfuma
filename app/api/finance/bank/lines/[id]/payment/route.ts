// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as bank from '@/lib/finance/bank';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/bank/lines/[id]/payment', 'finance.bank.reconcile', async ({ user, req, params }) => bank.paymentFromLine(user, params.id, await body(req)), 201);

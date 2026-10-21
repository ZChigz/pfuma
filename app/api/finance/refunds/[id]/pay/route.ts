// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as refunds from '@/lib/finance/refunds';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/refunds/[id]/pay', 'finance.refunds.pay', async ({ user, req, params }) => refunds.payRefund(user, params.id, await body(req)));

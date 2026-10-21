// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as payments from '@/lib/finance/payments';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/payments/[id]/void', 'finance.payments.void', async ({ user, req, params }) => payments.voidPayment(user, params.id, (await body(req) as { reason?: unknown }).reason));

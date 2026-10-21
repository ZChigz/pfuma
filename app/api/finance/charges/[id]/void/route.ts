// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as fees from '@/lib/finance/fees';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/charges/[id]/void', 'finance.charges.void', async ({ user, req, params }) => fees.voidCharge(user, params.id, (await body(req) as { reason?: unknown }).reason));

// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as credit from '@/lib/finance/credit';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/credit/transfer', 'finance.credit.transfer', async ({ user, req }) => credit.transferCredit(user, await body(req)), 201);

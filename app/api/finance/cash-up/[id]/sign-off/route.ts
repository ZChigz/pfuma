// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as cashup from '@/lib/finance/cashup';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/cash-up/[id]/sign-off', 'finance.cashup.signoff', async ({ user, params }) => cashup.signOffCashUp(user, params.id));

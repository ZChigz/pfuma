// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as cashup from '@/lib/finance/cashup';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/cash-up/[id]', ['finance.cashup.submit', 'finance.cashup.confirm', 'finance.cashup.signoff'], async ({ user, params }) => cashup.getCashUp(user, params.id));

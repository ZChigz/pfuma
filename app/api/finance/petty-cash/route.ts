// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as spending from '@/lib/finance/spending';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/petty-cash', ['finance.expenses.record', 'finance.expenses.manage'], async ({ user }) => spending.listFloats(user));
export const POST = guarded('POST /api/finance/petty-cash', 'finance.expenses.record', async ({ user, req }) => spending.petty(user, await body(req)), 201);

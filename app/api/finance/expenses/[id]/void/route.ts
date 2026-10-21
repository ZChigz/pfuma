// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as expenses from '@/lib/finance/expenses';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/expenses/[id]/void', 'finance.expenses.void', async ({ user, req, params }) => expenses.voidExpense(user, params.id, (await body(req) as { reason?: unknown }).reason));

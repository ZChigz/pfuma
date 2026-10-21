// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as spending from '@/lib/finance/spending';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/categories', ['finance.expenses.record', 'finance.expenses.manage', 'finance.budgets.manage', 'finance.requests.create', 'finance.requests.view'], async ({ user }) => spending.listCategories(user));
export const POST = guarded('POST /api/finance/categories', ['finance.budgets.manage', 'finance.expenses.manage'], async ({ user, req }) => spending.saveCategory(user, null, await body(req)), 201);

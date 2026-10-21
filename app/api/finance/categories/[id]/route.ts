// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as spending from '@/lib/finance/spending';

export const runtime = 'nodejs';

export const PATCH = guarded('PATCH /api/finance/categories/[id]', ['finance.budgets.manage', 'finance.expenses.manage'], async ({ user, req, params }) => spending.saveCategory(user, params.id, await body(req)));

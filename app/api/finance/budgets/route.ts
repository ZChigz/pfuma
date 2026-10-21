// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as spending from '@/lib/finance/spending';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/budgets', ['finance.budgets.manage', 'finance.reports.view', 'finance.dashboard.view'], async ({ user, query }) => spending.budgetReport(user, query.get('termId') || undefined));
export const POST = guarded('POST /api/finance/budgets', 'finance.budgets.manage', async ({ user, req }) => spending.saveBudget(user, await body(req)));

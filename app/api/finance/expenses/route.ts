// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as expenses from '@/lib/finance/expenses';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/expenses', ['finance.expenses.view', 'finance.expenses.record', 'finance.reports.view'], async ({ user, query }) => expenses.listExpenses(user, {
      fundId: query.get('fundId') || undefined, currency: (query.get('currency') as 'USD' | 'ZIG' | null) || undefined, from: query.get('from') || undefined, to: query.get('to') || undefined,
      includeVoided: query.get('voided') === '1', page: Number(query.get('page')) || undefined, pageSize: Number(query.get('pageSize')) || undefined,
    }));
export const POST = guarded('POST /api/finance/expenses', 'finance.expenses.record', async ({ user, req }) => expenses.recordDirectExpense(user, await body(req)), 201);

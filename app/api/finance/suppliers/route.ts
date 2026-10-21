// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as spending from '@/lib/finance/spending';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/suppliers', ['finance.suppliers.manage', 'finance.expenses.record', 'finance.expenses.manage', 'finance.requests.create', 'finance.requests.view'], async ({ user }) => spending.listSuppliers(user));
export const POST = guarded('POST /api/finance/suppliers', 'finance.suppliers.manage', async ({ user, req }) => spending.saveSupplier(user, null, await body(req)), 201);

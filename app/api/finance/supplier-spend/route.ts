// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as spending from '@/lib/finance/spending';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/supplier-spend', ['finance.suppliers.manage', 'finance.reports.view'], async ({ user, query }) => spending.supplierSpend(user, { from: query.get('from') ?? '', to: query.get('to') ?? '' }));

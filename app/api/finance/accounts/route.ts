// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as accounts from '@/lib/finance/accounts';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/accounts', ['finance.accounts.view', 'finance.payments.record', 'finance.payments.verify', 'finance.charges.create', 'finance.reports.view'], async ({ user, query }) => accounts.listAccounts(user, {
      q: query.get('q') || undefined, classId: query.get('classId') || undefined, owing: query.get('owing') === '1', fundId: query.get('fundId') || undefined,
      currency: (query.get('currency') as 'USD' | 'ZIG' | null) || undefined, page: Number(query.get('page')) || undefined, pageSize: Number(query.get('pageSize')) || undefined,
    }));

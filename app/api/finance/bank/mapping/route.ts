// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as bank from '@/lib/finance/bank';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/bank/mapping', 'finance.bank.reconcile', async ({ user, query }) => bank.loadMapping(user, query.get('bank') ?? ''));

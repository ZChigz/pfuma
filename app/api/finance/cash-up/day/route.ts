// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as cashup from '@/lib/finance/cashup';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/cash-up/day', ['finance.cashup.confirm', 'finance.cashup.signoff', 'finance.dashboard.view'], async ({ user, query }) => cashup.cashUpDay(user, query.get('date') || undefined));

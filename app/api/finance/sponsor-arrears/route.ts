// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as sponsors from '@/lib/finance/sponsors';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/sponsor-arrears', ['finance.sponsors.manage', 'finance.dashboard.view', 'finance.accounts.view'], async ({ user }) => sponsors.sponsorArrears(user));

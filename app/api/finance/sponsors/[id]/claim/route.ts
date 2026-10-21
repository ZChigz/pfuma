// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as sponsors from '@/lib/finance/sponsors';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/sponsors/[id]/claim', ['finance.sponsors.manage', 'finance.accounts.view'], async ({ user, params, query }) => sponsors.sponsorClaim(user, params.id, query.get('termId') || undefined));

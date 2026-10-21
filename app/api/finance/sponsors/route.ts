// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as sponsors from '@/lib/finance/sponsors';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/sponsors', ['finance.sponsors.manage', 'finance.awards.approve', 'finance.accounts.view'], async ({ user }) => sponsors.listSponsors(user));
export const POST = guarded('POST /api/finance/sponsors', 'finance.sponsors.manage', async ({ user, req }) => sponsors.saveSponsor(user, null, await body(req)), 201);

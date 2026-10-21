// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as sponsors from '@/lib/finance/sponsors';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/awards', ['finance.sponsors.manage', 'finance.awards.approve', 'finance.accounts.view'], async ({ user, query }) => sponsors.listAwards(user, { sponsorId: query.get('sponsorId') || undefined, studentId: query.get('studentId') || undefined, status: query.get('status') || undefined }));
export const POST = guarded('POST /api/finance/awards', 'finance.sponsors.manage', async ({ user, req }) => sponsors.createAward(user, await body(req)), 201);

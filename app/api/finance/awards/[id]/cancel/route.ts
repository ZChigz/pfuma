// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as sponsors from '@/lib/finance/sponsors';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/awards/[id]/cancel', ['finance.sponsors.manage', 'finance.awards.approve'], async ({ user, req, params }) => sponsors.cancelAward(user, params.id, await body(req)));

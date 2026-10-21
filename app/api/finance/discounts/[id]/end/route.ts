// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as discounts from '@/lib/finance/discounts';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/discounts/[id]/end', ['finance.adjustments.create', 'finance.adjustments.approve'], async ({ user, req, params }) => (async () => { const b = (await body(req)) as { termToId?: string }; return discounts.endRule(user, params.id, b.termToId); })());

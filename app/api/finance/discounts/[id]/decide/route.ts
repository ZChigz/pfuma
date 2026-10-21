// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as discounts from '@/lib/finance/discounts';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/discounts/[id]/decide', 'finance.adjustments.approve', async ({ user, req, params }) => (async () => { const b = (await body(req)) as { decision?: string; note?: unknown }; return discounts.decideRule(user, params.id, b.decision === 'approve' ? 'approve' : 'reject', b.note); })());

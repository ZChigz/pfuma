// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as plans from '@/lib/finance/plans';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/plans/[id]/cancel', ['finance.plans.manage', 'finance.plans.approve'], async ({ user, req, params }) => (async () => { const b = (await body(req)) as { reason?: unknown }; return plans.cancelPlan(user, params.id, b.reason); })());

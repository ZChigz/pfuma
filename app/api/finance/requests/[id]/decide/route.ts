// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as requests from '@/lib/finance/requests';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/requests/[id]/decide', 'finance.requests.approve', async ({ user, req, params }) => (async () => { const b = (await body(req)) as { decision?: string; reason?: unknown }; return requests.decideRequest(user, params.id, b.decision === 'approve' ? 'approve' : 'reject', b.reason); })());

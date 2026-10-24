// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as duties from '@/lib/hr/duties';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/hr/duties/swaps/[id]/reply', ["hr.self.details"], async ({ user, req, params }) => duties.replySwap(user, params.id!, await body(req)));

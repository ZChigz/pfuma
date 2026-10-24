// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as duties from '@/lib/hr/duties';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/duties/swaps', ["hr.self.details","hr.duties.manage"], async ({ user }) => duties.listSwaps(user));
export const POST = guarded('POST /api/hr/duties/swaps', ["hr.self.details"], async ({ user, req }) => duties.requestSwap(user, await body(req)), 201);

// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as requests from '@/lib/finance/requests';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/requests/[id]/overrun', 'finance.requests.approve', async ({ user, params }) => requests.approveOverrun(user, params.id));

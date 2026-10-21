// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as requests from '@/lib/finance/requests';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/requests', ['finance.requests.view', 'finance.requests.create', 'finance.requests.approve', 'finance.requests.disburse'], async ({ user, query }) => requests.listRequests(user, { status: (query.get('status') as 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISBURSED' | null) || undefined, mine: query.get('mine') === '1', page: Number(query.get('page')) || undefined }));
export const POST = guarded('POST /api/finance/requests', 'finance.requests.create', async ({ user, req }) => requests.createRequest(user, await body(req)), 201);

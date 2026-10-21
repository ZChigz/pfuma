// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as requests from '@/lib/finance/requests';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/requests/[id]', ['finance.requests.view', 'finance.requests.create', 'finance.requests.approve', 'finance.requests.disburse'], async ({ user, params }) => requests.getRequest(user, params.id));
export const PUT = guarded('PUT /api/finance/requests/[id]', 'finance.requests.create', async ({ user, req, params }) => requests.updateDraft(user, params.id, await body(req)));
export const DELETE = guarded('DELETE /api/finance/requests/[id]', 'finance.requests.create', async ({ user, params }) => requests.deleteDraft(user, params.id));

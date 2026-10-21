// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as structures from '@/lib/finance/structures';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/structures/[id]/lines', 'finance.fees.manage', async ({ user, req, params }) => structures.saveLine(user, params.id, null, await body(req)), 201);

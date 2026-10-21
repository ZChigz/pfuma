// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as structures from '@/lib/finance/structures';

export const runtime = 'nodejs';

export const PATCH = guarded('PATCH /api/finance/structures/[id]/lines/[lineId]', 'finance.fees.manage', async ({ user, req, params }) => structures.saveLine(user, params.id, params.lineId, await body(req)));
export const DELETE = guarded('DELETE /api/finance/structures/[id]/lines/[lineId]', 'finance.fees.manage', async ({ user, params }) => structures.deleteLine(user, params.id, params.lineId));

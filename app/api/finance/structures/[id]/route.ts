// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as structures from '@/lib/finance/structures';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/structures/[id]', ['finance.fees.view', 'finance.fees.manage', 'finance.charges.create', 'finance.billing.run', 'finance.fees.approve'], async ({ user, params }) => structures.getStructure(user, params.id));
export const DELETE = guarded('DELETE /api/finance/structures/[id]', 'finance.fees.manage', async ({ user, params }) => structures.deleteStructure(user, params.id));

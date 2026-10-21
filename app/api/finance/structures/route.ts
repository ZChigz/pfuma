// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as structures from '@/lib/finance/structures';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/structures', ['finance.fees.view', 'finance.fees.manage', 'finance.charges.create', 'finance.billing.run', 'finance.fees.approve'], async ({ user, query }) => structures.listStructures(user, query.get('termId') || undefined));
export const POST = guarded('POST /api/finance/structures', 'finance.fees.manage', async ({ user, req }) => structures.createStructure(user, await body(req)), 201);

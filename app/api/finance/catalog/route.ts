// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as structures from '@/lib/finance/structures';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/catalog', ['finance.fees.view', 'finance.fees.manage', 'finance.charges.create', 'finance.billing.run', 'finance.fees.approve'], async ({ user }) => structures.listCatalog(user));
export const POST = guarded('POST /api/finance/catalog', 'finance.fees.manage', async ({ user, req }) => structures.saveCatalogItem(user, null, await body(req)), 201);

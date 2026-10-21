// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as structures from '@/lib/finance/structures';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/structures/[id]/return', 'finance.fees.approve', async ({ user, params }) => structures.returnStructure(user, params.id));

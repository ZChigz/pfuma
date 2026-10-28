// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded, body } from '@/lib/finance/route';
import { registerFromRequest } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/assets/from-request', ['facilities.assets.manage'], async ({ user, req }) => registerFromRequest(user, await body(req)), 201);

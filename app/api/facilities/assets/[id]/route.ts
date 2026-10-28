// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded, body } from '@/lib/finance/route';
import { getAsset, updateAsset } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/assets/[id]', ['facilities.assets.view', 'facilities.assets.manage', 'facilities.assets.maintain', 'facilities.assets.dispose', 'facilities.assets.verify'], async ({ user, params }) => getAsset(user, params.id!));
export const PATCH = guarded('PATCH /api/facilities/assets/[id]', ['facilities.assets.manage'], async ({ user, params, req }) => updateAsset(user, { ...(await body(req) as object), id: params.id }));

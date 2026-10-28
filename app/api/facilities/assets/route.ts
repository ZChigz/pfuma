// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded, body } from '@/lib/finance/route';
import { listAssets, registerAsset } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/assets', ['facilities.assets.view', 'facilities.assets.manage', 'facilities.assets.maintain', 'facilities.assets.dispose', 'facilities.assets.verify'], async ({ user, query }) => listAssets(user, { q: query.get('q') || undefined, categoryId: query.get('categoryId') || undefined, location: query.get('location') || undefined, custodianId: query.get('custodianId') || undefined, status: query.get('status') || undefined, page: Number(query.get('page')) || undefined }));
export const POST = guarded('POST /api/facilities/assets', ['facilities.assets.manage'], async ({ user, req }) => registerAsset(user, await body(req)), 201);

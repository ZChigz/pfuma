// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded, body } from '@/lib/finance/route';
import { transferAsset } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/assets/transfers', ['facilities.assets.manage'], async ({ user, req }) => transferAsset(user, await body(req)), 201);

// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded, body } from '@/lib/finance/route';
import { moveToScanned } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/assets/rounds/[id]/move', ['facilities.assets.verify'], async ({ user, params, req }) => moveToScanned(user, params.id!, await body(req)));

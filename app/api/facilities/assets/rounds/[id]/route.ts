// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded } from '@/lib/finance/route';
import { roundResult } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/assets/rounds/[id]', ['facilities.assets.verify', 'facilities.assets.manage', 'facilities.assets.view'], async ({ user, params }) => roundResult(user, params.id!));

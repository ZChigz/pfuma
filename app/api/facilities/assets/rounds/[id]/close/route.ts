// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded } from '@/lib/finance/route';
import { roundResult } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/assets/rounds/[id]/close', ['facilities.assets.verify'], async ({ user, params }) => roundResult(user, params.id!, true));

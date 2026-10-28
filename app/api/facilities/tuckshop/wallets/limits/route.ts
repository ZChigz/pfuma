// Asks can() first; the service behind it checks the permission again and every tuck shop rule.
import { guarded, body } from '@/lib/finance/route';
import { setLimits } from '@/lib/facilities/tuckshop';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/tuckshop/wallets/limits', ['facilities.wallets.manage'], async ({ user, req }) => setLimits(user, await body(req)));

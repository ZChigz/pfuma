// Asks can() first; the service behind it checks the permission again and every tuck shop rule.
import { guarded } from '@/lib/finance/route';
import { trustCheck } from '@/lib/facilities/tuckshop';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/tuckshop/trust', ['facilities.wallets.manage', 'facilities.wallets.view', 'facilities.tuckshop.cashup'], async ({ user }) => trustCheck(user));

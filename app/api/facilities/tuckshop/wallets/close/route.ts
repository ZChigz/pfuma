// Asks can() first; the service behind it checks the permission again and every tuck shop rule.
import { guarded, body } from '@/lib/finance/route';
import { closeWallet } from '@/lib/facilities/tuckshop';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/tuckshop/wallets/close', ['facilities.wallets.manage'], async ({ user, req }) => closeWallet(user, await body(req)));

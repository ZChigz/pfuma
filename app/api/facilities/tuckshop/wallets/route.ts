// Asks can() first; the service behind it checks the permission again and every tuck shop rule.
import { guarded } from '@/lib/finance/route';
import { listWallets } from '@/lib/facilities/tuckshop';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/tuckshop/wallets', ['facilities.wallets.manage', 'facilities.wallets.view'], async ({ user, query }) => listWallets(user, { q: query.get('q') || undefined, lowOnly: query.get('low') === '1' }));

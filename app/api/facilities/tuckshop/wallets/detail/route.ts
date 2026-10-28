// Asks can() first; the service behind it checks the permission again and every tuck shop rule.
import { guarded } from '@/lib/finance/route';
import { walletDetail } from '@/lib/facilities/tuckshop';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/tuckshop/wallets/detail', ['facilities.wallets.manage', 'facilities.wallets.view'], async ({ user, query }) => walletDetail(user, query.get('studentId') ?? '', query.get('currency') ?? 'USD'));

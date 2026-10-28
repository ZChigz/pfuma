// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded } from '@/lib/finance/route';
import { requestsToRegister } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/assets/requests', ['facilities.assets.manage'], async ({ user }) => requestsToRegister(user));

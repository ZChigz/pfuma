// Asks can() first; the service behind it checks the permission again and every stock rule.
import { guarded } from '@/lib/finance/route';
import { requestsToReceive } from '@/lib/facilities/inventory';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/inventory/requests', ['facilities.inventory.receive'], async ({ user }) => requestsToReceive(user));

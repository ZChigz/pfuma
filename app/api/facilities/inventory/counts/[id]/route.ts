// Asks can() first; the service behind it checks the permission again and every stock rule.
import { guarded } from '@/lib/finance/route';
import { getCount } from '@/lib/facilities/inventory';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/inventory/counts/[id]', ['facilities.inventory.count', 'facilities.inventory.writeoff'], async ({ user, params }) => getCount(user, params.id!));

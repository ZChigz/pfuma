// Asks can() first; the service behind it checks the permission again and every stock rule.
import { guarded, body } from '@/lib/finance/route';
import { listCounts, startCount } from '@/lib/facilities/inventory';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/inventory/counts', ['facilities.inventory.count', 'facilities.inventory.writeoff'], async ({ user }) => listCounts(user));
export const POST = guarded('POST /api/facilities/inventory/counts', ['facilities.inventory.count'], async ({ user, req }) => startCount(user, await body(req)), 201);

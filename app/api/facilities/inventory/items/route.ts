// Asks can() first; the service behind it checks the permission again and every stock rule.
import { guarded, body } from '@/lib/finance/route';
import { saveItem, stockTable } from '@/lib/facilities/inventory';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/inventory/items', ['facilities.inventory.view', 'facilities.inventory.manage', 'facilities.inventory.receive', 'facilities.inventory.issue', 'facilities.inventory.count', 'facilities.inventory.writeoff'], async ({ user, query }) => stockTable(user, { storeId: query.get('storeId') || undefined, q: query.get('q') || undefined, category: query.get('category') || undefined, lowOnly: query.get('low') === '1' }));
export const POST = guarded('POST /api/facilities/inventory/items', ['facilities.inventory.manage'], async ({ user, req }) => saveItem(user, await body(req)), 201);

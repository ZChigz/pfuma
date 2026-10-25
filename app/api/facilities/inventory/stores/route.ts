// Asks can() first; the service behind it checks the permission again and every stock rule.
import { guarded, body } from '@/lib/finance/route';
import { listStores, saveStore } from '@/lib/facilities/inventory';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/inventory/stores', ['facilities.inventory.view', 'facilities.inventory.manage', 'facilities.inventory.receive', 'facilities.inventory.issue', 'facilities.inventory.count', 'facilities.inventory.writeoff'], async ({ user }) => listStores(user));
export const POST = guarded('POST /api/facilities/inventory/stores', ['facilities.inventory.manage'], async ({ user, req }) => saveStore(user, await body(req)), 201);

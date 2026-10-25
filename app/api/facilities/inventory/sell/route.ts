// Asks can() first; the service behind it checks the permission again and every stock rule.
import { guarded, body } from '@/lib/finance/route';
import { sellStock } from '@/lib/facilities/inventory';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/inventory/sell', ['facilities.inventory.issue'], async ({ user, req }) => sellStock(user, await body(req)), 201);

// Asks can() first; the service behind it checks the permission again and every stock rule.
import { guarded, body } from '@/lib/finance/route';
import { transferStock } from '@/lib/facilities/inventory';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/inventory/transfer', ['facilities.inventory.issue'], async ({ user, req }) => transferStock(user, await body(req)), 201);

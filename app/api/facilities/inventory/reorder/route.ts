// Asks can() first; the service behind it checks the permission again and every stock rule.
import { guarded, body } from '@/lib/finance/route';
import { reorderRequest } from '@/lib/facilities/inventory';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/inventory/reorder', ['facilities.inventory.manage', 'facilities.inventory.receive'], async ({ user, req }) => reorderRequest(user, await body(req)), 201);

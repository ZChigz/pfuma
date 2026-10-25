// Asks can() first; the service behind it checks the permission again and every stock rule.
import { guarded, body } from '@/lib/finance/route';
import { receiveStock } from '@/lib/facilities/inventory';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/inventory/receive', ['facilities.inventory.receive'], async ({ user, req }) => receiveStock(user, await body(req)), 201);

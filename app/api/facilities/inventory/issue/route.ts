// Asks can() first; the service behind it checks the permission again and every stock rule.
import { guarded, body } from '@/lib/finance/route';
import { issueStock } from '@/lib/facilities/inventory';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/inventory/issue', ['facilities.inventory.issue'], async ({ user, req }) => issueStock(user, await body(req)), 201);

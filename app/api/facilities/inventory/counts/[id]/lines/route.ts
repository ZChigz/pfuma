// Asks can() first; the service behind it checks the permission again and every stock rule.
import { guarded, body } from '@/lib/finance/route';
import { saveCountLines } from '@/lib/facilities/inventory';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/inventory/counts/[id]/lines', ['facilities.inventory.count'], async ({ user, params, req }) => saveCountLines(user, params.id!, await body(req)));

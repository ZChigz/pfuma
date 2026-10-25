// Asks can() first; the service behind it checks the permission again and every stock rule.
import { guarded, body } from '@/lib/finance/route';
import { decideCount } from '@/lib/facilities/inventory';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/inventory/counts/[id]/decide', ['facilities.inventory.writeoff'], async ({ user, params, req }) => decideCount(user, params.id!, await body(req)));

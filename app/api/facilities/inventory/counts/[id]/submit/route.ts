// Asks can() first; the service behind it checks the permission again and every stock rule.
import { guarded } from '@/lib/finance/route';
import { submitCount } from '@/lib/facilities/inventory';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/inventory/counts/[id]/submit', ['facilities.inventory.count'], async ({ user, params }) => submitCount(user, params.id!));

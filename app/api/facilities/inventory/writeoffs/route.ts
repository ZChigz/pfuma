// Asks can() first; the service behind it checks the permission again and every stock rule.
import { guarded, body } from '@/lib/finance/route';
import { listWriteoffs, requestWriteoff } from '@/lib/facilities/inventory';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/inventory/writeoffs', ['facilities.inventory.writeoff', 'facilities.inventory.issue', 'facilities.inventory.count'], async ({ user, query }) => listWriteoffs(user, (['PENDING', 'APPROVED', 'REJECTED'] as const).find((s) => s === query.get('status'))));
export const POST = guarded('POST /api/facilities/inventory/writeoffs', ['facilities.inventory.issue', 'facilities.inventory.count'], async ({ user, req }) => requestWriteoff(user, await body(req)), 201);

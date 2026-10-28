// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded, body } from '@/lib/finance/route';
import { listDisposals, requestDisposal } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/assets/disposals', ['facilities.assets.dispose', 'facilities.assets.manage', 'facilities.assets.view'], async ({ user, query }) => listDisposals(user, (['PENDING', 'APPROVED', 'REJECTED'] as const).find((s) => s === query.get('status'))));
export const POST = guarded('POST /api/facilities/assets/disposals', ['facilities.assets.manage'], async ({ user, req }) => requestDisposal(user, await body(req)), 201);

// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded, body } from '@/lib/finance/route';
import { decideDisposal } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/assets/disposals/[id]/decide', ['facilities.assets.dispose'], async ({ user, params, req }) => decideDisposal(user, params.id!, await body(req)));

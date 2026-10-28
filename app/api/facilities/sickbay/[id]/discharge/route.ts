// Asks can() first; the service behind it checks the permission again and every sick bay rule.
import { guarded, body } from '@/lib/finance/route';
import { discharge } from '@/lib/facilities/sickbay';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/sickbay/[id]/discharge', ['facilities.sickbay.record'], async ({ user, params, req }) => discharge(user, params.id!, await body(req)));

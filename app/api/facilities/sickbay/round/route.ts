// Asks can() first; the service behind it checks the permission again and every sick bay rule.
import { guarded, body } from '@/lib/finance/route';
import { closeRound, medicationRound } from '@/lib/facilities/sickbay';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/sickbay/round', ['facilities.sickbay.record'], async ({ user, query }) => medicationRound(user, query.get('date') || undefined));
export const POST = guarded('POST /api/facilities/sickbay/round', ['facilities.sickbay.record'], async ({ user, req }) => closeRound(user, await body(req)));

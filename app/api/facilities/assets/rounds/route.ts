// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded, body } from '@/lib/finance/route';
import { listRounds, startRound } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/assets/rounds', ['facilities.assets.verify', 'facilities.assets.manage', 'facilities.assets.view'], async ({ user }) => listRounds(user));
export const POST = guarded('POST /api/facilities/assets/rounds', ['facilities.assets.verify'], async ({ user, req }) => startRound(user, await body(req)), 201);

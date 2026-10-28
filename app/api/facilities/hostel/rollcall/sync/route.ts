// Asks can() first; the service behind it checks the permission again and every hostel rule.
import { guarded, body } from '@/lib/finance/route';
import { syncRollCalls } from '@/lib/facilities/hostel';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/hostel/rollcall/sync', ['facilities.hostel.rollcall'], async ({ user, req }) => syncRollCalls(user, await body(req)));

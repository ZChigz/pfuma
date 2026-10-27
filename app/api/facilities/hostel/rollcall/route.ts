// Asks can() first; the service behind it checks the permission again and every hostel rule.
import { guarded, body } from '@/lib/finance/route';
import { rollCallSheet, saveRollCall } from '@/lib/facilities/hostel';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/hostel/rollcall', ['facilities.hostel.rollcall', 'facilities.hostel.view'], async ({ user, query }) => rollCallSheet(user, { hostelId: query.get('hostelId') ?? '', date: query.get('date') || undefined, session: query.get('session') ?? 'EVENING' }));
export const POST = guarded('POST /api/facilities/hostel/rollcall', ['facilities.hostel.rollcall'], async ({ user, req }) => saveRollCall(user, await body(req)), 201);

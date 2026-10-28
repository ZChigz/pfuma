// Asks can() first; the service behind it checks the permission again and every hostel rule.
import { guarded, body } from '@/lib/finance/route';
import { saveRoom } from '@/lib/facilities/hostel';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/hostel/rooms', ['facilities.hostel.manage'], async ({ user, req }) => saveRoom(user, await body(req)), 201);

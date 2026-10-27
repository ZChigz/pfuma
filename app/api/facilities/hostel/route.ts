// Asks can() first; the service behind it checks the permission again and every hostel rule.
import { guarded, body } from '@/lib/finance/route';
import { listHostels, saveHostel } from '@/lib/facilities/hostel';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/hostel', ['facilities.hostel.view', 'facilities.hostel.manage', 'facilities.hostel.allocate', 'facilities.hostel.rollcall', 'facilities.hostel.inspect'], async ({ user }) => listHostels(user));
export const POST = guarded('POST /api/facilities/hostel', ['facilities.hostel.manage'], async ({ user, req }) => saveHostel(user, await body(req)), 201);

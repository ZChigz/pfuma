// Asks can() first; the service behind it checks the permission again and every hostel rule.
import { guarded } from '@/lib/finance/route';
import { getHostel } from '@/lib/facilities/hostel';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/hostel/[id]', ['facilities.hostel.view', 'facilities.hostel.manage', 'facilities.hostel.allocate', 'facilities.hostel.rollcall', 'facilities.hostel.inspect'], async ({ user, params }) => getHostel(user, params.id!));

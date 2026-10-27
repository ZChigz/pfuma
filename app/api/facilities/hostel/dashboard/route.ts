// Asks can() first; the service behind it checks the permission again and every hostel rule.
import { guarded } from '@/lib/finance/route';
import { hostelDashboard } from '@/lib/facilities/hostel';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/hostel/dashboard', ['facilities.hostel.view', 'facilities.hostel.manage', 'facilities.hostel.allocate', 'facilities.hostel.rollcall', 'facilities.hostel.inspect'], async ({ user }) => hostelDashboard(user));

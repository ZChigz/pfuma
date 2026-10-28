// Asks can() first; the service behind it checks the permission again and every hostel rule.
import { guarded } from '@/lib/finance/route';
import { rollCallStatus } from '@/lib/facilities/hostel';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/hostel/rollcall/status', ['facilities.hostel.view', 'facilities.hostel.rollcall', 'facilities.hostel.manage', 'facilities.hostel.allocate', 'facilities.hostel.inspect'], async ({ user, query }) => rollCallStatus(user, query.get('date') || undefined));

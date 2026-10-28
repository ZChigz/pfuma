// Asks can() first; the service behind it checks the permission again and every hostel rule.
import { guarded } from '@/lib/finance/route';
import { bedHistory } from '@/lib/facilities/hostel';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/hostel/bed-history', ['facilities.hostel.view', 'facilities.hostel.allocate', 'facilities.hostel.manage'], async ({ user, query }) => bedHistory(user, query.get('studentId') ?? ''));

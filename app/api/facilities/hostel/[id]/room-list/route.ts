// Asks can() first; the service behind it checks the permission again and every hostel rule.
import { guarded } from '@/lib/finance/route';
import { roomList } from '@/lib/facilities/hostel';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/hostel/[id]/room-list', ['facilities.hostel.view'], async ({ user, params }) => roomList(user, params.id!));

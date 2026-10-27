// Asks can() first; the service behind it checks the permission again and every hostel rule.
import { guarded, body } from '@/lib/finance/route';
import { autoAllocate } from '@/lib/facilities/hostel';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/hostel/auto-allocate', ['facilities.hostel.allocate'], async ({ user, req }) => autoAllocate(user, await body(req)));

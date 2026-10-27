// Asks can() first; the service behind it checks the permission again and every hostel rule.
import { guarded, body } from '@/lib/finance/route';
import { addBeds } from '@/lib/facilities/hostel';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/hostel/beds', ['facilities.hostel.manage'], async ({ user, req }) => addBeds(user, await body(req)), 201);

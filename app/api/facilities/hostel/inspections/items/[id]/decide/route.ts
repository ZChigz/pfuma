// Asks can() first; the service behind it checks the permission again and every hostel rule.
import { guarded, body } from '@/lib/finance/route';
import { decideDamage } from '@/lib/facilities/hostel';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/hostel/inspections/items/[id]/decide', ['facilities.hostel.manage'], async ({ user, params, req }) => decideDamage(user, params.id!, await body(req)));

// Asks can() first; the service behind it checks the permission again and every sick bay rule.
import { guarded } from '@/lib/finance/route';
import { sickBayMedicine } from '@/lib/facilities/sickbay';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/sickbay/medicine', ['facilities.sickbay.record'], async ({ user }) => sickBayMedicine(user));

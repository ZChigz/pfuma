// Asks can() first; the service behind it checks the permission again and every sick bay rule.
import { guarded } from '@/lib/finance/route';
import { sickBaySummary } from '@/lib/facilities/sickbay';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/sickbay/summary', ['facilities.sickbay.record', 'facilities.sickbay.view'], async ({ user }) => sickBaySummary(user));

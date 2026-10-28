// Asks can() first; the service behind it checks the permission again and every exeats rule.
import { guarded } from '@/lib/finance/route';
import { visitingDays } from '@/lib/facilities/exeats';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/exeats/visiting-days', ['facilities.visitors.log', 'facilities.exeats.request'], async ({ user }) => visitingDays(user));

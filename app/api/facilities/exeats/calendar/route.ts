// Asks can() first; the service behind it checks the permission again and every exeats rule.
import { guarded } from '@/lib/finance/route';
import { calendarOptions } from '@/lib/facilities/exeats';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/exeats/calendar', ['facilities.exeats.request', 'facilities.exeats.approve', 'facilities.visitors.log'], async ({ user }) => calendarOptions(user));

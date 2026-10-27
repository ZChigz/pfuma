// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded, body } from '@/lib/finance/route';
import { saveSchedule } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/assets/schedules', ['facilities.assets.maintain', 'facilities.assets.manage'], async ({ user, req }) => saveSchedule(user, await body(req)), 201);

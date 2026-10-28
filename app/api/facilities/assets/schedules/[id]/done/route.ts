// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded, body } from '@/lib/finance/route';
import { serviceDone } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/assets/schedules/[id]/done', ['facilities.assets.maintain'], async ({ user, params, req }) => serviceDone(user, params.id!, await body(req)), 201);

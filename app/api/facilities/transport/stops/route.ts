// Asks can() first; the service behind it checks the permission again and every transport rule.
import { guarded, body } from '@/lib/finance/route';
import { saveStop } from '@/lib/facilities/transport';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/transport/stops', ['facilities.transport.manage'], async ({ user, req }) => saveStop(user, await body(req)), 201);

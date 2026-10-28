// Asks can() first; the service behind it checks the permission again and every transport rule.
import { guarded, body } from '@/lib/finance/route';
import { saveDriver } from '@/lib/facilities/transport';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/transport/drivers', ['facilities.transport.manage'], async ({ user, req }) => saveDriver(user, await body(req)), 201);

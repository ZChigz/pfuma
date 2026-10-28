// Asks can() first; the service behind it checks the permission again and every transport rule.
import { guarded, body } from '@/lib/finance/route';
import { logFuel } from '@/lib/facilities/transport';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/transport/fuel', ['facilities.transport.trips'], async ({ user, req }) => logFuel(user, await body(req)), 201);

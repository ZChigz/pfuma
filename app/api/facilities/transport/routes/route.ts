// Asks can() first; the service behind it checks the permission again and every transport rule.
import { guarded, body } from '@/lib/finance/route';
import { listRoutes, saveRoute } from '@/lib/facilities/transport';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/transport/routes', ['facilities.transport.view', 'facilities.transport.manage', 'facilities.transport.trips', 'facilities.transport.assign'], async ({ user }) => listRoutes(user));
export const POST = guarded('POST /api/facilities/transport/routes', ['facilities.transport.manage'], async ({ user, req }) => saveRoute(user, await body(req)), 201);

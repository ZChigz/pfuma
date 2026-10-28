// Asks can() first; the service behind it checks the permission again and every transport rule.
import { guarded, body } from '@/lib/finance/route';
import { recentTrips, recordTrip } from '@/lib/facilities/transport';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/transport/trips', ['facilities.transport.view', 'facilities.transport.manage', 'facilities.transport.trips', 'facilities.transport.assign'], async ({ user, query }) => recentTrips(user, query.get('days') ? Number(query.get('days')) : undefined));
export const POST = guarded('POST /api/facilities/transport/trips', ['facilities.transport.trips'], async ({ user, req }) => recordTrip(user, await body(req)), 201);

// Asks can() first; the service behind it checks the permission again and every transport rule.
import { guarded, body } from '@/lib/finance/route';
import { listBookings, requestBooking } from '@/lib/facilities/transport';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/transport/bookings', ['facilities.transport.view', 'facilities.transport.manage', 'facilities.transport.trips', 'facilities.transport.assign'], async ({ user }) => listBookings(user));
export const POST = guarded('POST /api/facilities/transport/bookings', ['facilities.transport.manage', 'facilities.transport.trips'], async ({ user, req }) => requestBooking(user, await body(req)), 201);

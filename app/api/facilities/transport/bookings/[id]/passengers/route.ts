// Asks can() first; the service behind it checks the permission again and every transport rule.
import { guarded, body } from '@/lib/finance/route';
import { addBookingPassengers } from '@/lib/facilities/transport';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/transport/bookings/[id]/passengers', ['facilities.transport.manage', 'facilities.transport.assign'], async ({ user, params, req }) => addBookingPassengers(user, params.id!, await body(req)), 201);

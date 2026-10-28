// Asks can() first; the service behind it checks the permission again and every transport rule.
import { guarded, body } from '@/lib/finance/route';
import { decideBooking } from '@/lib/facilities/transport';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/transport/bookings/[id]/decide', ['facilities.transport.manage'], async ({ user, params, req }) => decideBooking(user, params.id!, await body(req)));

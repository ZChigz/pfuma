// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded } from '@/lib/finance/route';
import { cancelReservation } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/library/reservations/[id]/cancel', ['facilities.library.desk'], async ({ user, params }) => cancelReservation(user, params.id!));

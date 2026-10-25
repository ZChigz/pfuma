// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded, body } from '@/lib/finance/route';
import { reserveTitle } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/library/reservations', ['facilities.library.desk'], async ({ user, req }) => reserveTitle(user, await body(req)), 201);

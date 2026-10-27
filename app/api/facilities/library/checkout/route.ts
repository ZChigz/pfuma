// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded, body } from '@/lib/finance/route';
import { checkout } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/library/checkout', ['facilities.library.desk'], async ({ user, req }) => checkout(user, await body(req)), 201);

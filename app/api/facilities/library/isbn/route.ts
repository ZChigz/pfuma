// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded } from '@/lib/finance/route';
import { lookupIsbn } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/library/isbn', ['facilities.library.manage'], async ({ user, query }) => lookupIsbn(user, query.get('isbn') ?? ''));

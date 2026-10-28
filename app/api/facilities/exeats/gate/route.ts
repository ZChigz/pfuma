// Asks can() first; the service behind it checks the permission again and every exeats rule.
import { guarded } from '@/lib/finance/route';
import { gateLookup } from '@/lib/facilities/exeats';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/exeats/gate', ['facilities.exeats.signout', 'facilities.exeats.request', 'facilities.exeats.approve'], async ({ user, query }) => gateLookup(user, query.get('code') ?? ''));

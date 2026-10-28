// Asks can() first; the service behind it checks the permission again and every transport rule.
import { guarded } from '@/lib/finance/route';
import { fleet } from '@/lib/facilities/transport';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/transport/fleet', ['facilities.transport.view', 'facilities.transport.manage', 'facilities.transport.trips', 'facilities.transport.assign'], async ({ user }) => fleet(user));

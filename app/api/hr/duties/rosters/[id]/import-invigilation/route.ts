// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as duties from '@/lib/hr/duties';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/hr/duties/rosters/[id]/import-invigilation', ["hr.duties.manage"], async ({ user, params }) => duties.importInvigilation(user, params.id!));

// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as duties from '@/lib/hr/duties';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/hr/duties/rosters/[id]/approve', ["hr.duties.approve"], async ({ user, params }) => duties.approveRoster(user, params.id!));

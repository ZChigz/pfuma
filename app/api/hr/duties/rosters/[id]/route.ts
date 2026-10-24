// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as duties from '@/lib/hr/duties';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/duties/rosters/[id]', ["hr.duties.view","hr.duties.manage","hr.duties.approve"], async ({ user, params }) => duties.getRoster(user, params.id!));

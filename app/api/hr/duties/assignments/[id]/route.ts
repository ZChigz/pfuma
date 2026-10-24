// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as duties from '@/lib/hr/duties';

export const runtime = 'nodejs';

export const DELETE = guarded('DELETE /api/hr/duties/assignments/[id]', ["hr.duties.manage"], async ({ user, params }) => duties.removeDuty(user, params.id!));

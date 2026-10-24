// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as disc from '@/lib/hr/discipline';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/hr/discipline', ["hr.discipline.manage"], async ({ user, req }) => disc.saveDiscipline(user, await body(req)), 201);

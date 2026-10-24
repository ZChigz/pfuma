// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as disc from '@/lib/hr/discipline';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/employees/[id]/discipline', ["hr.discipline.view","hr.discipline.manage"], async ({ user, params }) => disc.listDiscipline(user, params.id!));

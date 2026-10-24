// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded } from '@/lib/finance/route';
import * as rec from '@/lib/hr/recruitment';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/vacancies/[id]/applicants', ["hr.recruitment.manage"], async ({ user, params }) => rec.listApplicants(user, params.id!));

// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as rec from '@/lib/hr/recruitment';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/vacancies', ["hr.recruitment.manage","hr.posts.approve"], async ({ user }) => rec.listVacancies(user));
export const POST = guarded('POST /api/hr/vacancies', ["hr.recruitment.manage"], async ({ user, req }) => rec.openVacancy(user, await body(req)), 201);

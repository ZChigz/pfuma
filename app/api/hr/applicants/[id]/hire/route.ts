// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as rec from '@/lib/hr/recruitment';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/hr/applicants/[id]/hire', ["hr.recruitment.manage"], async ({ user, req, params }) => rec.hireApplicant(user, params.id!, await body(req)), 201);

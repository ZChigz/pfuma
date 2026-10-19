import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { createDepartment, listDepartments } from '@/lib/academics/subjects';

export const runtime = 'nodejs';

async function _GET() {
  const user = await requirePermission('academics.subjects.view');
  return apiSuccess({ departments: await listDepartments(user) });
}

async function _POST(req: Request) {
  const user = await requirePermission('academics.subjects.manage');
  return apiSuccess({ department: await createDepartment(user, await readBody(req)) }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/departments', _GET as H);
export const POST = withApi('POST /api/academics/departments', _POST as H);

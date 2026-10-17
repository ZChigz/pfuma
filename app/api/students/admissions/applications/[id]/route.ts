import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { UpdateApplicationSchema, updateApplication } from '@/lib/students/admissions';

// Test score, interview notes, results and the class the applicant is meant for.
async function _PATCH(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.admissions.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  const body = await parseBody(req, UpdateApplicationSchema);
  if ('error' in body) return body.error;
  return apiSuccess(await updateApplication(user, id, body.data));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/students/admissions/applications/[id]', _PATCH as H);

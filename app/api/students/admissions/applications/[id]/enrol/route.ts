import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { EnrolSchema, enrolApplicant } from '@/lib/students/admissions';

// Turn an accepted applicant into a student in the chosen class. With dryRun it only reports the warnings
// (age, class full, duplicates) so they can be shown first and acknowledged.
async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.admissions.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  const body = await parseBody(req, EnrolSchema);
  if ('error' in body) return body.error;
  const result = await enrolApplicant(user, id, body.data);
  return apiSuccess(result, result.dryRun ? 200 : 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/admissions/applications/[id]/enrol', _POST as H);

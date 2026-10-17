import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { MoveSchema, moveApplications } from '@/lib/students/admissions';

// Move applicants to a stage (shortlist, test, reject, waitlist, decline, or offer). One or many at once: all or nothing.
// An offer needs the Head's approval: only someone who holds students.admissions.approve can make one.
async function _POST(req: Request) {
  const user = await requirePermission('students.admissions.manage');
  const body = await parseBody(req, MoveSchema);
  if ('error' in body) return body.error;
  return apiSuccess(await moveApplications(user, body.data));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/admissions/applications/move', _POST as H);

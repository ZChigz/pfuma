import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { profileEnrolment } from '@/lib/students/profile';

// The Enrolment tab: class history by term, admission details and class moves with their reasons.
async function _GET(_req: Request, ctx?: unknown) {
  const user = await requirePermission('students.enrolment.view');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await profileEnrolment(user, id));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/[id]/enrolment', _GET as H);

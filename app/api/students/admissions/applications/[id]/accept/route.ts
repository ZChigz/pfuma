import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { AcceptSchema, acceptOffer } from '@/lib/students/admissions';

// The guardian accepted the offer: records the date and, when Finance is on, whether the acceptance deposit is paid.
async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.admissions.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  const body = await parseBody(req, AcceptSchema);
  if ('error' in body) return body.error;
  return apiSuccess(await acceptOffer(user, id, body.data));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/admissions/applications/[id]/accept', _POST as H);

import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { ConfirmSchema, confirmPromotion } from '@/lib/students/promotion';

// Step 5: the Head approves. One transaction creates the Term 1 enrollments, sets the status of leavers and writes
// an audit entry per student plus a summary. The approver is recorded.
async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.promotion.approve');
  const { runId } = (ctx as { params: { runId: string } }).params;
  const body = await parseBody(req, ConfirmSchema);
  if ('error' in body) return body.error;
  return apiSuccess(await confirmPromotion(user, runId, body.data));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/promotion/[runId]/confirm', _POST as H);

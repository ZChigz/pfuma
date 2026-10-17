import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { SaveDraftSchema, promotionState, savePromotionDraft } from '@/lib/students/promotion';

// Steps 1 to 4 of the year-end promotion: the proposal for every student, the draft's decisions on top, and the review.
async function _GET(req: Request) {
  const user = await requirePermission('students.promotion.manage');
  const fromYearId = new URL(req.url).searchParams.get('fromYearId') || undefined;
  return apiSuccess({ promotion: await promotionState(user, fromYearId) });
}

// Save the decisions as a draft to finish later. Nothing about any student changes.
async function _PUT(req: Request) {
  const user = await requirePermission('students.promotion.manage');
  const body = await parseBody(req, SaveDraftSchema);
  if ('error' in body) return body.error;
  return apiSuccess(await savePromotionDraft(user, body.data));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/promotion', _GET as H);
export const PUT = withApi('PUT /api/students/promotion', _PUT as H);

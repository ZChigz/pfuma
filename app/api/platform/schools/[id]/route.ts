import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { requirePlatformAdmin } from '@/lib/platform/session';
import { getSchoolDetail, updateBilling } from '@/lib/platform/schools';
import { BillingPatchSchema } from '@/lib/validations/platform';

async function _GET(req: Request, ctx: { params: { id: string } }) {
  await requirePlatformAdmin(req);
  return apiSuccess(await getSchoolDetail(ctx.params.id));
}

// Plan, student limit, renewal date and status (not suspension: that has its own route).
async function _PATCH(req: Request, ctx: { params: { id: string } }) {
  const admin = await requirePlatformAdmin(req);
  const parsed = await parseBody(req, BillingPatchSchema);
  if ('error' in parsed) return parsed.error;
  return apiSuccess(await updateBilling(admin, ctx.params.id, parsed.data));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/platform/schools/[id]', _GET as H);
export const PATCH = withApi('PATCH /api/platform/schools/[id]', _PATCH as H);

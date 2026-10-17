import { apiSuccess, withApi } from '@/lib/api';
import { requirePlatformAdmin } from '@/lib/platform/session';
import { reactivateSchool } from '@/lib/platform/schools';

async function _POST(req: Request, ctx: { params: { id: string } }) {
  const admin = await requirePlatformAdmin(req);
  return apiSuccess(await reactivateSchool(admin, ctx.params.id));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/platform/schools/[id]/reactivate', _POST as H);

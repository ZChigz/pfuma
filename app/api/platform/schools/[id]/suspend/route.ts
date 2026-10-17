import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { requirePlatformAdmin } from '@/lib/platform/session';
import { suspendSchool } from '@/lib/platform/schools';
import { SuspendSchema } from '@/lib/validations/platform';

async function _POST(req: Request, ctx: { params: { id: string } }) {
  const admin = await requirePlatformAdmin(req);
  const parsed = await parseBody(req, SuspendSchema);
  if ('error' in parsed) return parsed.error;
  return apiSuccess(await suspendSchool(admin, ctx.params.id, parsed.data.reason));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/platform/schools/[id]/suspend', _POST as H);

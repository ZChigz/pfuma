import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { requirePlatformAdmin } from '@/lib/platform/session';
import { setSchoolModules } from '@/lib/platform/schools';
import { ModulesPatchSchema } from '@/lib/validations/platform';

// Modules on or off for a school, one by one or by applying a preset.
async function _PATCH(req: Request, ctx: { params: { id: string } }) {
  const admin = await requirePlatformAdmin(req);
  const parsed = await parseBody(req, ModulesPatchSchema);
  if ('error' in parsed) return parsed.error;
  return apiSuccess({ modules: await setSchoolModules(admin, ctx.params.id, parsed.data) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/platform/schools/[id]/modules', _PATCH as H);

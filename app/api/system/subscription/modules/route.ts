import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { getModuleStates, setModules } from '@/lib/system/modules';
import { ModulesSchema } from '@/lib/validations/system';

async function _GET() {
  const user = await requirePermission('system.subscription.view');
  const db = getScopedDb(user.schoolId, user.id);
  return apiSuccess({ modules: await getModuleStates(db) });
}

async function _PATCH(req: Request) {
  const user = await requirePermission('system.subscription.manage');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, ModulesSchema);
  if ('error' in parsed) return parsed.error;
  return apiSuccess({ modules: await setModules(db, user, parsed.data.modules) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/subscription/modules', _GET as H);
export const PATCH = withApi('PATCH /api/system/subscription/modules', _PATCH as H);

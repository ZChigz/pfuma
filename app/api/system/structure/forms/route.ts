import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { setForms } from '@/lib/system/structure';
import { FormsSchema } from '@/lib/validations/system';

async function _PATCH(req: Request) {
  const user = await requirePermission('system.settings.edit');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, FormsSchema);
  if ('error' in parsed) return parsed.error;
  return apiSuccess(await setForms(db, user, parsed.data.forms));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/system/structure/forms', _PATCH as H);

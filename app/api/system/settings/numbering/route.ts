import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { updateNumberingSettings } from '@/lib/system/settings';
import { NumberingSchema } from '@/lib/validations/system';

async function _PATCH(req: Request) {
  const user = await requirePermission('system.settings.edit');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, NumberingSchema);
  if ('error' in parsed) return parsed.error;
  return apiSuccess({ school: await updateNumberingSettings(db, user, parsed.data) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/system/settings/numbering', _PATCH as H);

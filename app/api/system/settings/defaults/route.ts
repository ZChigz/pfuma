import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { updateSchoolDefaults } from '@/lib/system/settings';
import { SchoolDefaultsSchema } from '@/lib/validations/system';

async function _PATCH(req: Request) {
  const user = await requirePermission('system.settings.edit');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, SchoolDefaultsSchema);
  if ('error' in parsed) return parsed.error;
  return apiSuccess({ school: await updateSchoolDefaults(db, user, parsed.data) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/system/settings/defaults', _PATCH as H);

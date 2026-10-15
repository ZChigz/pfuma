import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { getSchoolProfile, updateSchoolProfile } from '@/lib/system/settings';
import { SchoolSettingsSchema } from '@/lib/validations/system';

async function _GET() {
  const user = await requirePermission('system.settings.view');
  const db = getScopedDb(user.schoolId, user.id);
  return apiSuccess({ school: await getSchoolProfile(db, user.schoolId) });
}

async function _PATCH(req: Request) {
  const user = await requirePermission('system.settings.update');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, SchoolSettingsSchema);
  if ('error' in parsed) return parsed.error;
  return apiSuccess({ school: await updateSchoolProfile(db, user, parsed.data) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/settings', _GET as H);
export const PATCH = withApi('PATCH /api/system/settings', _PATCH as H);

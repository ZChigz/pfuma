import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { getSchoolProfile } from '@/lib/system/settings';

// Changing settings goes through /settings/profile and /settings/defaults, one route per tab.
async function _GET() {
  const user = await requirePermission('system.settings.view');
  const db = getScopedDb(user.schoolId, user.id);
  return apiSuccess({ school: await getSchoolProfile(db, user.schoolId) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/settings', _GET as H);

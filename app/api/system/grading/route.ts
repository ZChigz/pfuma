import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { getScales } from '@/lib/system/grading';

async function _GET() {
  const user = await requirePermission('system.settings.view');
  const db = getScopedDb(user.schoolId, user.id);
  return apiSuccess({ scales: await getScales(db, user.schoolId) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/grading', _GET as H);

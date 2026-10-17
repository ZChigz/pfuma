import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { HouseSchema, listHouses, saveHouse } from '@/lib/students/houses';

// Houses are set up in Settings. Anyone who can see students can see the list (it fills the filter);
// changing it needs system.settings.edit.
async function _GET() {
  const user = await requirePermission('students.profiles.view');
  return apiSuccess({ houses: await listHouses(user) });
}

async function _POST(req: Request) {
  const user = await requirePermission('system.settings.edit');
  const body = await parseBody(req, HouseSchema);
  if ('error' in body) return body.error;
  return apiSuccess({ house: await saveHouse(user, body.data) }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/houses', _GET as H);
export const POST = withApi('POST /api/system/houses', _POST as H);

import { requirePermission, requireSignedIn } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { listRequests, requestAccess } from '@/lib/system/access-admin';

// The queue the Administrator (and the Owner) decide.
async function _GET(req: Request) {
  const user = await requirePermission('system.users.edit');
  const status = new URL(req.url).searchParams.get('status');
  return apiSuccess({ requests: await listRequests(getScopedDb(user.schoolId, user.id), { status: status === 'PENDING' || status === 'APPROVED' || status === 'DECLINED' ? status : undefined }) });
}

// "Request access" on the access-denied page: any signed-in person may ask.
async function _POST(req: Request) {
  const user = await requireSignedIn();
  const body = await req.json().catch(() => ({}));
  return apiSuccess(await requestAccess(getScopedDb(user.schoolId, user.id), user, body), 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/access-requests', _GET as H);
export const POST = withApi('POST /api/system/access-requests', _POST as H);

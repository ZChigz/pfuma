import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { getSettings, saveSettings } from '@/lib/academics/settings';

export const runtime = 'nodejs';

async function _GET() {
  const user = await requirePermission('academics.classes.view');
  return apiSuccess({ settings: await getSettings(user) });
}

async function _PUT(req: Request) {
  const user = await requirePermission('system.settings.edit');
  return apiSuccess({ settings: await saveSettings(user, await readBody(req)) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/settings', _GET as H);
export const PUT = withApi('PUT /api/academics/settings', _PUT as H);

import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { addStream } from '@/lib/system/structure';
import { StreamNameSchema } from '@/lib/validations/system';

async function _POST(req: Request) {
  const user = await requirePermission('system.structure.update');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, StreamNameSchema);
  if ('error' in parsed) return parsed.error;
  return apiSuccess({ stream: await addStream(db, user, parsed.data.name) }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/system/structure/streams', _POST as H);

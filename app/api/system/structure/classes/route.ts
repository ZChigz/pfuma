import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { saveClassGrid } from '@/lib/system/structure';
import { ClassGridSchema } from '@/lib/validations/system';

// Saves the forms-by-streams grid in one go: either every change is made or none is.
async function _PUT(req: Request) {
  const user = await requirePermission('system.structure.update');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, ClassGridSchema);
  if ('error' in parsed) return parsed.error;
  return apiSuccess(await saveClassGrid(db, user, parsed.data.cells));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PUT = withApi('PUT /api/system/structure/classes', _PUT as H);

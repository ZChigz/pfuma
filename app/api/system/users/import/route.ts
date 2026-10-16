import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { csvResponse } from '@/lib/csv';
import { IMPORT_TEMPLATE, importUsers } from '@/lib/system/users';
import { ImportUsersSchema } from '@/lib/validations/system';

// The template file: name, email, phone, roles.
async function _GET() {
  await requirePermission('system.users.import');
  return csvResponse('users-template.csv', IMPORT_TEMPLATE);
}

// Adds every valid row and reports the rejected ones with the reason. Each new person gets an
// invite link; the links are in this response only and are not stored.
async function _POST(req: Request) {
  const user = await requirePermission('system.users.import');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, ImportUsersSchema);
  if ('error' in parsed) return parsed.error;
  return apiSuccess(await importUsers(db, user, parsed.data.csv));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/users/import', _GET as H);
export const POST = withApi('POST /api/system/users/import', _POST as H);

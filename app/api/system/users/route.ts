import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { parseTableQuery } from '@/lib/table-query';
import { csvResponse, toCsv } from '@/lib/csv';
import { createUser, listUsers, USER_FILTERS, USER_SORTABLE } from '@/lib/system/users';
import { SystemCreateUserSchema } from '@/lib/validations/system';

async function _GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const wantsCsv = params.get('format') === 'csv';
  const user = await requirePermission(wantsCsv ? 'system.users.export' : 'system.users.view');
  const db = getScopedDb(user.schoolId, user.id);
  const q = parseTableQuery(params, { sortable: USER_SORTABLE, filterKeys: USER_FILTERS, defaultSort: 'fullName' });

  const { total, rows } = await listUsers(db, q, { all: wantsCsv });
  if (wantsCsv) {
    return csvResponse(
      'users.csv',
      toCsv(['Name', 'Email', 'Role', 'Status', 'Added'], rows.map((r) => [r.fullName, r.email, r.role, r.active ? 'Active' : 'Inactive', r.createdAt])),
    );
  }
  return apiSuccess({ total, page: q.page, pageSize: q.pageSize, users: rows });
}

async function _POST(req: Request) {
  const user = await requirePermission('system.users.create');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, SystemCreateUserSchema);
  if ('error' in parsed) return parsed.error;
  const created = await createUser(db, user, parsed.data);
  return apiSuccess(created, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/users', _GET as H);
export const POST = withApi('POST /api/system/users', _POST as H);

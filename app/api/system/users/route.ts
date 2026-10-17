import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { parseTableQuery } from '@/lib/table-query';
import { csvResponse, toCsv } from '@/lib/csv';
import { createUser, listUsers, statusOf, userCounts, USER_FILTERS, USER_SORTABLE } from '@/lib/system/users';
import { STAFF_ROLE_LABEL } from '@/lib/staff-roles';
import { SystemCreateUserSchema } from '@/lib/validations/system';

const STATUS_LABEL = { invited: 'Invited', active: 'Active', deactivated: 'Deactivated' } as const;

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
      toCsv(
        ['Name', 'Email', 'Phone', 'Roles', 'Status', 'Last login', 'Joined'],
        rows.map((r) => [r.fullName, r.email, r.phone, r.roles.map((k) => STAFF_ROLE_LABEL[k]).join('; '), STATUS_LABEL[statusOf(r)], r.lastLoginAt, r.createdAt]),
      ),
    );
  }
  return apiSuccess({ total, page: q.page, pageSize: q.pageSize, counts: await userCounts(db), users: rows.map((r) => ({ ...r, status: statusOf(r) })) });
}

// Adds a person. The response holds the invite link (or the temporary password) once; it is not stored.
async function _POST(req: Request) {
  const user = await requirePermission('system.users.create');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, SystemCreateUserSchema);
  if ('error' in parsed) return parsed.error;
  const created = await createUser(db, user, parsed.data);
  return apiSuccess({ ...created, user: { ...created.user, status: statusOf(created.user) } }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/users', _GET as H);
export const POST = withApi('POST /api/system/users', _POST as H);

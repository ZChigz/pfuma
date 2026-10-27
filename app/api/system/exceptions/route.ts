import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { csvResponse, toCsv } from '@/lib/csv';
import { listExceptions } from '@/lib/system/access-admin';

// The "Active exceptions" report. ?history=1 adds the ones that have ended; ?format=csv downloads it (needs the export permission).
async function _GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const csv = params.get('format') === 'csv';
  const user = await requirePermission(csv ? 'system.users.export' : 'system.roles.view');
  const rows = await listExceptions(getScopedDb(user.schoolId, user.id), { history: params.get('history') === '1' });
  if (csv) {
    return csvResponse('exceptions.csv', toCsv(
      ['Person', 'Permission', 'Effect', 'Reason', 'Until', 'Given by', 'State'],
      rows.map((r) => [r.userName, r.label, r.effect, r.reason, r.expiresAt, r.createdBy, r.state]),
    ));
  }
  return apiSuccess({ exceptions: rows });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/exceptions', _GET as H);

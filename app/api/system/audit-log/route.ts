import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { parseTableQuery } from '@/lib/table-query';
import { csvResponse, toCsv } from '@/lib/csv';
import { AUDIT_FILTER_KEYS, AUDIT_SORTABLE, listAuditLog } from '@/lib/system/audit-log';

async function _GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const wantsCsv = params.get('format') === 'csv';
  const user = await requirePermission(wantsCsv ? 'system.audit.export' : 'system.audit.view');
  const db = getScopedDb(user.schoolId, user.id);
  const q = parseTableQuery(params, { sortable: AUDIT_SORTABLE, filterKeys: AUDIT_FILTER_KEYS, defaultSort: 'createdAt', defaultDir: 'desc' });

  const { total, rows } = await listAuditLog(db, q, { all: wantsCsv });
  if (wantsCsv) {
    return csvResponse(
      'audit-log.csv',
      toCsv(
        ['When', 'Who', 'Action', 'Record type', 'Record ID', 'Detail'],
        rows.map((r) => [r.createdAt, r.actor.fullName, r.action, r.entityType, r.entityId, r.detail]),
      ),
    );
  }
  return apiSuccess({ total, page: q.page, pageSize: q.pageSize, entries: rows });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/audit-log', _GET as H);

import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { parseTableQuery } from '@/lib/table-query';
import { csvResponse, toCsv } from '@/lib/csv';
import { AUDIT_FILTER_KEYS, AUDIT_SORTABLE, listAuditLog } from '@/lib/system/audit-log';
import { actionLabel, entityLabel, moduleLabel } from '@/lib/system/audit-labels';

// Read-only on purpose: there is no POST, PATCH or DELETE for the audit log, and the database refuses
// changes to it as well.
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
        ['Date and time', 'User', 'Action', 'Action code', 'Module', 'Record type', 'Record', 'Record ID', 'IP'],
        rows.map((r) => [r.createdAt, r.actor.fullName, actionLabel(r.action), r.action, moduleLabel(r.module), entityLabel(r.entityType), r.detail, r.entityId, r.ip]),
      ),
    );
  }
  return apiSuccess({ total, page: q.page, pageSize: q.pageSize, entries: rows });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/audit-log', _GET as H);

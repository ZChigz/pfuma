import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { ImportBodySchema, checkImportRows, importSummary, skippedReportCsv } from '@/lib/students/import';
import type { ImportRow } from '@/lib/students/import-map';

// The review step: every row marked OK, Warning or Error with the reason. Changes nothing, so the admin can
// edit cells and check again as often as needed.
async function _POST(req: Request) {
  const user = await requirePermission('students.profiles.import');
  const body = await parseBody(req, ImportBodySchema);
  if ('error' in body) return body.error;
  const rows = await checkImportRows(user, body.data.rows as { rowNumber: number; values: ImportRow }[]);
  return apiSuccess({ rows: rows.map((r) => ({ rowNumber: r.rowNumber, status: r.status, messages: r.messages, name: r.name })), summary: importSummary(rows), reportCsv: skippedReportCsv(rows) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/import/check', _POST as H);

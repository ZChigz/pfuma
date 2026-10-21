// Any of the ten finance reports as a table: JSON for the screen, or ?format=csv|xlsx|pdf (which needs the export permission).
import { guarded } from '@/lib/finance/route';
import { ServiceError } from '@/lib/api';
import { REPORT_SLUGS, runReport, type ReportSlug } from '@/lib/finance/report-tables';
import { asFormat, tableResponse } from '@/lib/finance/downloads';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/reports/table/[slug]', 'finance.reports.view', async ({ user, params, query }) => {
  if (!(REPORT_SLUGS as readonly string[]).includes(params.slug)) throw new ServiceError('Report not found', 404);
  const t = await runReport(user, params.slug as ReportSlug, Object.fromEntries(Array.from(query.entries()).filter(([k]) => k !== 'format')));
  return tableResponse(user, t, asFormat(query.get('format')), `${t.slug}-${new Date().toISOString().slice(0, 10)}`);
});

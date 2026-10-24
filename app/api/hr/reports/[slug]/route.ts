// Any HR report as a table: JSON for the screen, or ?format=csv|xlsx|pdf (audited).
import { guarded } from '@/lib/finance/route';
import { ServiceError } from '@/lib/api';
import { HR_REPORT_SLUGS, runHrReport, type HrReportSlug } from '@/lib/hr/reports';
import { asFormat, hrTableResponse } from '@/lib/hr/downloads';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/reports/[slug]', ['hr.reports.view', 'hr.payroll.view'], async ({ user, params, query }) => {
  if (!(HR_REPORT_SLUGS as readonly string[]).includes(params.slug!)) throw new ServiceError('Report not found', 404);
  const t = await runHrReport(user, params.slug as HrReportSlug, Object.fromEntries(Array.from(query.entries()).filter(([k]) => k !== 'format')));
  return hrTableResponse(user, t, asFormat(query.get('format')), `${t.slug}-${new Date().toISOString().slice(0, 10)}`);
});

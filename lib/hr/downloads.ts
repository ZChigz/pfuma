// HR tables as CSV, Excel or PDF. Files need hr.reports.view (or payroll access for pay reports); every download is audited.
import { ServiceError } from '@/lib/api';
import { csvResponse, toCsv } from '@/lib/csv';
import { pdfResponse } from '@/lib/students/pdf';
import { tableXlsx } from '@/lib/exams/files';
import { getScopedDb } from '@/lib/scoped-db';
import { TableDocument } from '@/components/finance/pdf/Documents';
import { schoolHead } from '@/lib/finance/downloads';
import { audit, hrHolds, type Actor } from '@/lib/hr/common';
import type { HrTable } from '@/lib/hr/reports';

export type TableFormat = 'json' | 'csv' | 'xlsx' | 'pdf';
export const asFormat = (v: string | null): TableFormat => (v === 'csv' || v === 'xlsx' || v === 'pdf' ? v : 'json');

export async function hrTableResponse(user: Actor, t: HrTable, format: TableFormat, fileBase: string): Promise<Response | HrTable> {
  if (format === 'json') return t;
  if (user.noExport) throw new ServiceError('Forbidden', 403);
  if (!hrHolds(user, 'hr.reports.view') && !hrHolds(user, 'hr.payroll.view')) throw new ServiceError('Forbidden', 403);
  await getScopedDb(user.schoolId, user.id).$tx((tx) => audit(tx, user, 'HR_EXPORT_REPORT', 'HrReport', t.slug, `Downloaded the ${t.title} report as ${format}`, undefined, { rows: t.rows.length }));
  const all = [...t.rows, ...(t.totals ? [t.totals] : [])];
  if (format === 'csv') return csvResponse(`${fileBase}.csv`, toCsv(t.headers, all));
  if (format === 'xlsx') {
    const buf = await tableXlsx(t.title, t.headers, all);
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${fileBase}.xlsx"`, 'Cache-Control': 'no-store' } });
  }
  return pdfResponse(TableDocument, { doc: t, head: await schoolHead(user) }, `${fileBase}.pdf`);
}

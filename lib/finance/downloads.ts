// Shared by the Finance download routes: the school's letterhead, and any table as CSV, Excel or PDF.
import QRCode from 'qrcode';
import { getScopedDb } from '@/lib/scoped-db';
import { csvResponse, toCsv } from '@/lib/csv';
import { pdfResponse } from '@/lib/students/pdf';
import { fetchPdfImage } from '@/lib/system/pdf-image';
import { tableXlsx } from '@/lib/exams/files';
import { ServiceError } from '@/lib/api';
import { holds, type Actor } from '@/lib/finance/common';
import { TableDocument, type TableDoc } from '@/components/finance/pdf/Documents';
import type { LetterheadData } from '@/components/students/pdf/Letterhead';

export async function schoolHead(user: Actor): Promise<LetterheadData> {
  const s = await getScopedDb(user.schoolId, user.id).school.findFirst({ where: { id: user.schoolId }, select: { name: true, motto: true, address: true, phone: true, email: true, logoUrl: true } });
  return { name: s?.name ?? '', motto: s?.motto, address: s?.address, phone: s?.phone, email: s?.email, logo: await fetchPdfImage(s?.logoUrl) };
}

export const qrDataUrl = (text: string) => QRCode.toDataURL(text, { margin: 1, width: 240 });

export type TableFormat = 'json' | 'csv' | 'xlsx' | 'pdf';
export const asFormat = (v: string | null): TableFormat => (v === 'csv' || v === 'xlsx' || v === 'pdf' ? v : 'json');

/** A table in the format asked for. Files need the export permission; the screen version does not. */
export async function tableResponse(user: Actor, t: TableDoc & { slug?: string }, format: TableFormat, fileBase: string): Promise<Response | TableDoc> {
  if (format === 'json') return t;
  if (!holds(user, 'finance.reports.export')) throw new ServiceError('Forbidden', 403);
  if (format === 'csv') return csvResponse(`${fileBase}.csv`, toCsv(t.headers, [...t.rows, ...(t.totals ? [t.totals] : [])]));
  if (format === 'xlsx') {
    const buf = await tableXlsx(t.title, t.headers, [...t.rows, ...(t.totals ? [t.totals] : [])]);
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${fileBase}.xlsx"`, 'Cache-Control': 'no-store' } });
  }
  return pdfResponse(TableDocument, { doc: t, head: await schoolHead(user) }, `${fileBase}.pdf`);
}

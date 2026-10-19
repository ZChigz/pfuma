import { guarded } from '@/lib/exams/route';
import { exportCsv, exportEntryList } from '@/lib/exams/board';
import { tableXlsx } from '@/lib/exams/files';

export const runtime = 'nodejs';

// The approved entry list in the configured column order, as Excel or CSV. ?format=csv|xlsx. Audit-logged.
export const GET = guarded('GET /api/exams/board/sessions/[id]/export', ['exams.zimsec.manage', 'exams.zimsec.approve'], async ({ user, params, query }) => {
  const e = await exportEntryList(user, params.id!);
  const name = e.fileName.replace(/[^A-Za-z0-9._ -]/g, '-');
  if (query.get('format') === 'csv') {
    return new Response(`﻿${exportCsv(e)}`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"`, 'Cache-Control': 'no-store' } });
  }
  return new Response(new Uint8Array(await tableXlsx('Entry list', e.headers, e.rows)), {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}.xlsx"`, 'Cache-Control': 'no-store' },
  });
});

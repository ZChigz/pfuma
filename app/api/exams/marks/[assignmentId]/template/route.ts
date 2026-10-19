import { guarded, ANY_EXAM_VIEW } from '@/lib/exams/route';
import { buildTemplate } from '@/lib/exams/import';
import { templateCsv, templateXlsx } from '@/lib/exams/files';

export const runtime = 'nodejs';

// The pre-filled template for one assessment: admission number, name, mark. ?assessmentId=...&stageId=...&format=csv|xlsx
export const GET = guarded('GET /api/exams/marks/[assignmentId]/template', ANY_EXAM_VIEW, async ({ user, params, query }) => {
  const t = await buildTemplate(user, { assignmentId: params.assignmentId, assessmentId: query.get('assessmentId') ?? '', stageId: query.get('stageId') || null });
  const name = t.fileName.replace(/[^A-Za-z0-9._ -]/g, '-');
  if (query.get('format') === 'xlsx') {
    return new Response(new Uint8Array(await templateXlsx(t)), {
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}.xlsx"`, 'Cache-Control': 'no-store' },
    });
  }
  return new Response(`﻿${templateCsv(t)}`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"`, 'Cache-Control': 'no-store' } });
});

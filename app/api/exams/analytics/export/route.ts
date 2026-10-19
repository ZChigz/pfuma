import { guarded } from '@/lib/exams/route';
import { panelXlsx, type PanelKey } from '@/lib/exams/analytics';

export const runtime = 'nodejs';

const FILTERS = ['termId', 'levelId', 'classId', 'subjectId', 'gender', 'assessmentId', 'source', 'studentId', 'sessionId'];

// Every panel exports to Excel, as it is shown. Audit-logged.
export const GET = guarded('GET /api/exams/analytics/export', 'exams.analytics.view', async ({ user, query }) => {
  const filters = Object.fromEntries(FILTERS.flatMap((k) => (query.get(k) ? [[k, query.get(k)!]] : [])));
  const { fileName, buffer } = await panelXlsx(user, (query.get('panel') ?? 'overview') as PanelKey, filters);
  return new Response(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' },
  });
});

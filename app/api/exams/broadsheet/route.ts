import { guarded } from '@/lib/exams/route';
import { broadsheetXlsx } from '@/lib/exams/files';

export const runtime = 'nodejs';

// The class results sheet in Excel: every student and subject. ?classId=... or ?levelId=... (a whole form), &termId=...
export const GET = guarded('GET /api/exams/broadsheet', ['exams.results.view', 'exams.results.publish'], async ({ user, query }) => {
  const { fileName, buffer } = await broadsheetXlsx(user, { classId: query.get('classId') ?? undefined, levelId: query.get('levelId') ?? undefined, termId: query.get('termId') ?? undefined });
  return new Response(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' },
  });
});

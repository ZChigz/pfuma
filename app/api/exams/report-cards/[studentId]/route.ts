import { guarded } from '@/lib/exams/route';
import { reportCardData } from '@/lib/exams/publish';
import { cardsPdf } from '@/lib/exams/report-card-files';

export const runtime = 'nodejs';

const WHO = ['exams.results.view', 'exams.reports.view', 'exams.results.publish', 'exams.comments.class'] as const;

// One student's report card as a PDF. ?termId=...&draft=1 (the Head can open a draft of a class that is not published yet).
export const GET = guarded('GET /api/exams/report-cards/[studentId]', [...WHO], async ({ user, params, query, req }) => {
  const card = await reportCardData(user, params.studentId!, query.get('termId') ?? undefined, { draft: query.get('draft') === '1' });
  return cardsPdf([card], new URL(req.url).origin, `Report card ${card.student.name} ${card.term.name}.pdf`);
});

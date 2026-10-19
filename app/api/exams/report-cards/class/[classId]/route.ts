import { guarded } from '@/lib/exams/route';
import { classReportCards } from '@/lib/exams/publish';
import { cardsPdf } from '@/lib/exams/report-card-files';

export const runtime = 'nodejs';

// Every report card of a class in one PDF, ready to print. ?termId=...&draft=1
export const GET = guarded('GET /api/exams/report-cards/class/[classId]', ['exams.results.view', 'exams.reports.view', 'exams.results.publish', 'exams.comments.class'], async ({ user, params, query, req }) => {
  const cards = await classReportCards(user, params.classId!, query.get('termId') ?? undefined, { draft: query.get('draft') === '1' });
  return cardsPdf(cards, new URL(req.url).origin, `Report cards ${cards[0]!.student.className} ${cards[0]!.term.name}.pdf`);
});

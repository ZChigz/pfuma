import { guarded } from '@/lib/exams/route';
import { resultsSummary } from '@/lib/exams/analytics';

export const runtime = 'nodejs';

// The one-page results summary for staff and board meetings (the page at /print/exams/summary draws it).
export const GET = guarded('GET /api/exams/analytics/summary', 'exams.analytics.view', async ({ user, query }) =>
  resultsSummary(user, { termId: query.get('termId') ?? undefined, source: query.get('source') === 'verified' ? 'verified' : 'published' }));

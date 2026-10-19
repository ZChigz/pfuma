import { guarded } from '@/lib/exams/route';
import { boardResultsFor } from '@/lib/exams/board';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/board/results', ['exams.results.view', 'exams.zimsec.manage', 'exams.zimsec.approve', 'exams.zimsec.results_import', 'exams.analytics.view'], async ({ user, query }) => boardResultsFor(user, query.get('studentId') ?? ''));

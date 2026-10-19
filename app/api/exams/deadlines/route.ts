import { guarded, body, ANY_EXAM_VIEW } from '@/lib/exams/route';
import { getDeadlines, setDeadlines } from '@/lib/exams/setup';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/deadlines', ANY_EXAM_VIEW, async ({ user, query }) => getDeadlines(user, query.get('termId') ?? ''));
export const PUT = guarded('PUT /api/exams/deadlines', 'exams.setup.manage', async ({ user, req }) => setDeadlines(user, await body(req)));

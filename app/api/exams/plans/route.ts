import { guarded, body, ANY_EXAM_VIEW } from '@/lib/exams/route';
import { listPlans, savePlan } from '@/lib/exams/setup';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/plans', ANY_EXAM_VIEW, async ({ user, query }) => listPlans(user, query.get('termId') ?? ''));
export const PUT = guarded('PUT /api/exams/plans', 'exams.setup.manage', async ({ user, req }) => savePlan(user, await body(req)));

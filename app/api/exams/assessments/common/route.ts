import { guarded, body } from '@/lib/exams/route';
import { createCommonAssessments } from '@/lib/exams/assessments';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/assessments/common', 'exams.setup.manage', async ({ user, req }) => createCommonAssessments(user, await body(req)), 201);

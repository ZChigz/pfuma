import { guarded, body } from '@/lib/exams/route';
import { createAssessment } from '@/lib/exams/assessments';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/assessments', 'exams.assessments.create', async ({ user, req }) => createAssessment(user, await body(req)), 201);

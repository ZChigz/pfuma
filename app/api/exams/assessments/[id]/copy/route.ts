import { guarded, body } from '@/lib/exams/route';
import { copyAssessment } from '@/lib/exams/assessments';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/assessments/[id]/copy', ['exams.assessments.create', 'exams.setup.manage'], async ({ user, req, params }) => copyAssessment(user, params.id!, await body(req)), 201);

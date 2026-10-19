import { guarded, ANY_EXAM_VIEW } from '@/lib/exams/route';
import { listAssessments } from '@/lib/exams/assessments';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/assignments/[id]/assessments', ANY_EXAM_VIEW, async ({ user, params }) => listAssessments(user, params.id!));

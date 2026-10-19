import { guarded, body, ANY_EXAM_VIEW } from '@/lib/exams/route';
import { rubricFor, scoreRubric } from '@/lib/exams/projects';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/rubric', ANY_EXAM_VIEW, async ({ user, query }) => rubricFor(user, query.get('assignmentId') ?? '', query.get('assessmentId') ?? '', query.get('stageId') ?? '', query.get('studentId') ?? ''));
export const PUT = guarded('PUT /api/exams/rubric', 'exams.marks.enter', async ({ user, req }) => scoreRubric(user, await body(req)));

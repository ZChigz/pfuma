import { guarded, ANY_EXAM_VIEW } from '@/lib/exams/route';
import { loadGrid } from '@/lib/exams/marks';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/marks/[assignmentId]', ANY_EXAM_VIEW, async ({ user, params }) => loadGrid(user, params.assignmentId!));

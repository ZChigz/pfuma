import { guarded, ANY_EXAM_VIEW } from '@/lib/exams/route';
import { reviewSheet } from '@/lib/exams/sheets';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/sheets/[assignmentId]/review', ANY_EXAM_VIEW, async ({ user, params }) => reviewSheet(user, params.assignmentId!));

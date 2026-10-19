import { guarded } from '@/lib/exams/route';
import { submissionCheck } from '@/lib/exams/sheets';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/sheets/[assignmentId]/check', 'exams.marks.submit', async ({ user, params }) => submissionCheck(user, params.assignmentId!));

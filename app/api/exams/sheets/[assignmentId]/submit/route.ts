import { guarded } from '@/lib/exams/route';
import { submitSheet } from '@/lib/exams/sheets';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/sheets/[assignmentId]/submit', 'exams.marks.submit', async ({ user, params }) => submitSheet(user, params.assignmentId!));

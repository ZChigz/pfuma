import { guarded } from '@/lib/exams/route';
import { verifySheet } from '@/lib/exams/sheets';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/sheets/[assignmentId]/verify', 'exams.marks.verify', async ({ user, params }) => verifySheet(user, params.assignmentId!));

import { guarded, body } from '@/lib/exams/route';
import { unlockSheet } from '@/lib/exams/sheets';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/sheets/[assignmentId]/unlock', 'exams.marks.unlock', async ({ user, req, params }) => unlockSheet(user, params.assignmentId!, await body(req)));

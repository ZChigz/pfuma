import { guarded, body } from '@/lib/exams/route';
import { returnSheet } from '@/lib/exams/sheets';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/sheets/[assignmentId]/return', 'exams.marks.verify', async ({ user, req, params }) => returnSheet(user, params.assignmentId!, await body(req)));

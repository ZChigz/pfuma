import { guarded, body } from '@/lib/exams/route';
import { syncMarks } from '@/lib/exams/marks';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/marks/sync', 'exams.marks.enter', async ({ user, req }) => syncMarks(user, await body(req)));

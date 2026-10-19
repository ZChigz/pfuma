import { guarded, body } from '@/lib/exams/route';
import { saveMarks } from '@/lib/exams/marks';

export const runtime = 'nodejs';

export const PUT = guarded('PUT /api/exams/marks', 'exams.marks.enter', async ({ user, req }) => saveMarks(user, await body(req)));

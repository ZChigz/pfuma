import { guarded, body } from '@/lib/exams/route';
import { saveSubjectComments } from '@/lib/exams/publish';

export const runtime = 'nodejs';

export const PUT = guarded('PUT /api/exams/marks/sheet-comments', 'exams.comments.subject', async ({ user, req }) => saveSubjectComments(user, await body(req)));

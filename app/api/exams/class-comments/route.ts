import { guarded, body } from '@/lib/exams/route';
import { classComments, saveClassComments } from '@/lib/exams/publish';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/class-comments', ['exams.comments.class', 'exams.comments.head', 'exams.results.view'], async ({ user, query }) => classComments(user, query.get('classId') ?? '', query.get('termId') ?? undefined));
export const PUT = guarded('PUT /api/exams/class-comments', ['exams.comments.class', 'exams.comments.head'], async ({ user, req }) => saveClassComments(user, await body(req)));

import { guarded, body, ANY_EXAM_VIEW } from '@/lib/exams/route';
import { listCommentBank, addCommentBankItem } from '@/lib/exams/setup';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/comment-bank', ANY_EXAM_VIEW, async ({ user }) => listCommentBank(user));
export const POST = guarded('POST /api/exams/comment-bank', ['exams.setup.manage', 'exams.comments.head'], async ({ user, req }) => addCommentBankItem(user, await body(req)), 201);

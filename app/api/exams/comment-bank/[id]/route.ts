import { guarded } from '@/lib/exams/route';
import { removeCommentBankItem } from '@/lib/exams/setup';

export const runtime = 'nodejs';

export const DELETE = guarded('DELETE /api/exams/comment-bank/[id]', ['exams.setup.manage', 'exams.comments.head'], async ({ user, params }) => removeCommentBankItem(user, params.id!));

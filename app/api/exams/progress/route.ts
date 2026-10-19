import { guarded } from '@/lib/exams/route';
import { termProgress } from '@/lib/exams/sheets';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/progress', ['exams.marks.view', 'exams.marks.unlock', 'exams.setup.manage'], async ({ user, query }) => termProgress(user, query.get('termId') ?? undefined));

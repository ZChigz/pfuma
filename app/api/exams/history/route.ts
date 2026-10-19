import { guarded } from '@/lib/exams/route';
import { studentMarkHistory } from '@/lib/exams/sheets';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/history', ['exams.results.view', 'exams.marks.view'], async ({ user, query }) => studentMarkHistory(user, query.get('studentId') ?? '', query.get('termId') ?? undefined));

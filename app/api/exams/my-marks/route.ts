import { guarded, ANY_EXAM_VIEW } from '@/lib/exams/route';
import { mySheets } from '@/lib/exams/sheets';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/my-marks', ANY_EXAM_VIEW, async ({ user, query }) => mySheets(user, { termId: query.get('termId') ?? undefined, all: query.get('all') === '1' }));

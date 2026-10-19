import { guarded } from '@/lib/exams/route';
import { prePublishCheck } from '@/lib/exams/publish';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/publish/check', ['exams.results.publish', 'exams.results.view'], async ({ user, query }) => prePublishCheck(user, query.get('classId') ?? '', query.get('termId') ?? undefined));

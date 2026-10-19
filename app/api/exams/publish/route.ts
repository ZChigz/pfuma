import { guarded, body } from '@/lib/exams/route';
import { publishClasses } from '@/lib/exams/publish';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/publish', 'exams.results.publish', async ({ user, req }) => publishClasses(user, await body(req)));

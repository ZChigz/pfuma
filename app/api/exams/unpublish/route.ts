import { guarded, body } from '@/lib/exams/route';
import { unpublishClasses } from '@/lib/exams/publish';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/unpublish', 'exams.results.unpublish', async ({ user, req }) => unpublishClasses(user, await body(req)));

import { guarded, body, ANY_EXAM_VIEW } from '@/lib/exams/route';
import { listTypes, createType } from '@/lib/exams/setup';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/types', ANY_EXAM_VIEW, async ({ user }) => listTypes(user));
export const POST = guarded('POST /api/exams/types', 'exams.setup.manage', async ({ user, req }) => createType(user, await body(req)), 201);

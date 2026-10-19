import { guarded, body } from '@/lib/exams/route';
import { updateType } from '@/lib/exams/setup';

export const runtime = 'nodejs';

export const PATCH = guarded('PATCH /api/exams/types/[id]', 'exams.setup.manage', async ({ user, req, params }) => updateType(user, params.id!, await body(req)));

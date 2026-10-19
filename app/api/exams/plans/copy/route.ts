import { guarded, body } from '@/lib/exams/route';
import { copyPlans } from '@/lib/exams/setup';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/plans/copy', 'exams.setup.manage', async ({ user, req }) => copyPlans(user, await body(req)));

import { guarded } from '@/lib/exams/route';
import { removeSubjectPlan } from '@/lib/exams/setup';

export const runtime = 'nodejs';

export const DELETE = guarded('DELETE /api/exams/plans/[id]', 'exams.setup.manage', async ({ user, params }) => removeSubjectPlan(user, params.id!));

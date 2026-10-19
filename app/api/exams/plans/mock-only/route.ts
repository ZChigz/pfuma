import { guarded } from '@/lib/exams/route';
import { mockOnlyPlan } from '@/lib/exams/setup';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/plans/mock-only', 'exams.setup.manage', async ({ user }) => mockOnlyPlan(user));

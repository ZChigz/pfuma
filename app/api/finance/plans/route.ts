// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as plans from '@/lib/finance/plans';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/plans', ['finance.plans.manage', 'finance.plans.approve', 'finance.statements.view', 'finance.accounts.view'], async ({ user, query }) => plans.listPlans(user, { guardianId: query.get('guardianId') || undefined, studentId: query.get('studentId') || undefined, status: query.get('status') || undefined }));
export const POST = guarded('POST /api/finance/plans', 'finance.plans.manage', async ({ user, req }) => plans.createPlan(user, await body(req)), 201);

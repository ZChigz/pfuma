// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as discounts from '@/lib/finance/discounts';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/discounts', ['finance.adjustments.create', 'finance.adjustments.approve', 'finance.accounts.view'], async ({ user, query }) => discounts.listRules(user, { status: (query.get('status') as 'PENDING' | 'APPROVED' | 'REJECTED' | null) || undefined, studentId: query.get('studentId') || undefined }));
export const POST = guarded('POST /api/finance/discounts', 'finance.adjustments.create', async ({ user, req }) => discounts.createRule(user, await body(req)), 201);

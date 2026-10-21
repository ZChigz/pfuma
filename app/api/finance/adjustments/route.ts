// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as adjustments from '@/lib/finance/adjustments';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/adjustments', ['finance.adjustments.create', 'finance.adjustments.approve', 'finance.accounts.view'], async ({ user, query }) => adjustments.listAdjustments(user, { status: (query.get('status') as 'PENDING' | 'APPROVED' | 'REJECTED' | null) || undefined, studentId: query.get('studentId') || undefined, page: Number(query.get('page')) || undefined }));
export const POST = guarded('POST /api/finance/adjustments', 'finance.adjustments.create', async ({ user, req }) => adjustments.requestAdjustment(user, await body(req)), 201);

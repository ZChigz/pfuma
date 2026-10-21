// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as refunds from '@/lib/finance/refunds';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/refunds', ['finance.refunds.request', 'finance.refunds.approve', 'finance.refunds.pay', 'finance.payments.view'], async ({ user, query }) => refunds.listRefunds(user, { status: (query.get('status') as 'REQUESTED' | 'APPROVED' | 'PAID' | 'REJECTED' | null) || undefined, page: Number(query.get('page')) || undefined }));
export const POST = guarded('POST /api/finance/refunds', 'finance.refunds.request', async ({ user, req }) => refunds.requestRefund(user, await body(req)), 201);

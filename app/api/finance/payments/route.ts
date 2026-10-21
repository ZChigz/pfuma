// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as payments from '@/lib/finance/payments';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/payments', ['finance.payments.view', 'finance.payments.record', 'finance.payments.verify'], async ({ user, query }) => payments.listPayments(user, {
      status: (query.get('status') as 'PENDING' | 'VERIFIED' | 'REJECTED' | 'VOIDED' | null) || undefined, fundId: query.get('fundId') || undefined, currency: (query.get('currency') as 'USD' | 'ZIG' | null) || undefined,
      from: query.get('from') || undefined, to: query.get('to') || undefined, studentId: query.get('studentId') || undefined, q: query.get('q') || undefined,
      page: Number(query.get('page')) || undefined, pageSize: Number(query.get('pageSize')) || undefined,
    }));
export const POST = guarded('POST /api/finance/payments', 'finance.payments.record', async ({ user, req }) => payments.recordPayment(user, await body(req)), 201);

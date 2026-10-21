// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as payments from '@/lib/finance/payments';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/payments/apply-credit/[studentId]', 'finance.payments.allocate', async ({ user, params }) => payments.applyCredit(user, params.studentId));

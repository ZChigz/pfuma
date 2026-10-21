// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as payments from '@/lib/finance/payments';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/payments/[id]', ['finance.payments.view', 'finance.payments.record', 'finance.payments.verify'], async ({ user, params }) => payments.getReceipt(user, params.id));

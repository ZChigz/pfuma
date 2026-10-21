// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as accounts from '@/lib/finance/accounts';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/accounts/[studentId]', ['finance.accounts.view', 'finance.payments.record', 'finance.payments.verify', 'finance.charges.create', 'finance.reports.view'], async ({ user, params }) => accounts.getAccount(user, params.studentId));

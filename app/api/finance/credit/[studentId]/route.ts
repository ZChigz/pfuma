// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as credit from '@/lib/finance/credit';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/credit/[studentId]', ['finance.accounts.view', 'finance.statements.view', 'finance.payments.view', 'finance.credit.transfer'], async ({ user, params }) => credit.creditLedger(user, params.studentId));

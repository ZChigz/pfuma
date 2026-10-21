// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as billing from '@/lib/finance/billing';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/billing/runs', ['finance.billing.run', 'finance.fees.view'], async ({ user, query }) => billing.listBillingRuns(user, query.get('termId') || undefined));

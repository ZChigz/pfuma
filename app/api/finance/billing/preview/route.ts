// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as billing from '@/lib/finance/billing';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/billing/preview', 'finance.billing.run', async ({ user, req }) => billing.previewBilling(user, await body(req)));

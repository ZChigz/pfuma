// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as discounts from '@/lib/finance/discounts';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/sibling-rule', ['finance.fees.view', 'finance.fees.manage', 'finance.adjustments.approve', 'finance.billing.run'], async ({ user }) => discounts.getSiblingRule(user));
export const PUT = guarded('PUT /api/finance/sibling-rule', 'finance.fees.manage', async ({ user, req }) => discounts.saveSiblingRule(user, await body(req)));

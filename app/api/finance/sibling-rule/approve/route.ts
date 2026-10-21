// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as discounts from '@/lib/finance/discounts';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/sibling-rule/approve', 'finance.adjustments.approve', async ({ user }) => discounts.approveSiblingRule(user));

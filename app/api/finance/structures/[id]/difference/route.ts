// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as billing from '@/lib/finance/billing';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/structures/[id]/difference', 'finance.billing.run', async ({ user, params }) => billing.billDifference(user, params.id));

// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as sponsors from '@/lib/finance/sponsors';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/sponsor-payments/[id]/verify', 'finance.payments.verify', async ({ user, params }) => sponsors.verifySponsorPayment(user, params.id));

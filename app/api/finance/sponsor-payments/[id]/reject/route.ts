// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as sponsors from '@/lib/finance/sponsors';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/sponsor-payments/[id]/reject', 'finance.payments.verify', async ({ user, req, params }) => (async () => { const b = (await body(req)) as { reason?: unknown }; return sponsors.rejectSponsorPayment(user, params.id, b.reason); })());

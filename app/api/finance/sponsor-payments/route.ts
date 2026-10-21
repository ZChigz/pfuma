// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as sponsors from '@/lib/finance/sponsors';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/sponsor-payments', ['finance.sponsors.manage', 'finance.payments.view'], async ({ user, query }) => sponsors.listSponsorPayments(user, query.get('sponsorId') || undefined));
export const POST = guarded('POST /api/finance/sponsor-payments', ['finance.payments.record', 'finance.sponsors.manage'], async ({ user, req }) => sponsors.recordSponsorPayment(user, await body(req)), 201);

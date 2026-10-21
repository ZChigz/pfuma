// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded, body } from '@/lib/finance/route';
import * as invoices from '@/lib/finance/invoices';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/invoices', ['finance.accounts.view', 'finance.statements.view'], async ({ user, query }) => invoices.listInvoices(user, { studentId: query.get('studentId') || undefined, termId: query.get('termId') || undefined }));
export const POST = guarded('POST /api/finance/invoices', 'finance.billing.run', async ({ user, req }) => invoices.createInvoices(user, await body(req)), 201);

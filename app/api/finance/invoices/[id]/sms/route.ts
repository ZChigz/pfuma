// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as invoices from '@/lib/finance/invoices';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/invoices/[id]/sms', 'finance.statements.view', async ({ user, params }) => invoices.sendInvoiceSms(user, params.id));

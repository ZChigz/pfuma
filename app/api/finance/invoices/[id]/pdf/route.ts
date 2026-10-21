import { guarded } from '@/lib/finance/route';
import { getInvoice } from '@/lib/finance/invoices';
import { schoolHead } from '@/lib/finance/downloads';
import { pdfResponse } from '@/lib/students/pdf';
import { InvoiceDocument } from '@/components/finance/pdf/Documents';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/invoices/[id]/pdf', ['finance.statements.view', 'finance.accounts.view'], async ({ user, params }) => {
  const inv = await getInvoice(user, params.id);
  return pdfResponse(InvoiceDocument, { invoices: [inv.data], head: await schoolHead(user) }, `invoice-${inv.data.number}.pdf`);
});

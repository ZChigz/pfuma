import { createElement } from 'react';
import { renderToStream } from '@react-pdf/renderer';
import { requirePermission } from '@/lib/access';
import { apiNotFound, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { SubscriptionPdf } from '@/components/system/SubscriptionPdf';

export const runtime = 'nodejs';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// Pfuma's invoice to this school as a PDF. Only the school's own invoices can be reached.
async function _GET(_req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.subscription.view');
  const db = getScopedDb(user.schoolId, user.id);
  const [invoice, school] = await Promise.all([
    db.subscriptionInvoice.findFirst({ where: { id: ctx.params.id } }),
    db.school.findUnique({ where: { id: user.schoolId }, select: { name: true } }),
  ]);
  if (!invoice) return apiNotFound('Invoice');

  const stream = await renderToStream(
    createElement(SubscriptionPdf, {
      data: {
        number: invoice.number, schoolName: school?.name ?? '', issuedOn: day(invoice.issuedOn)!, dueOn: day(invoice.dueOn), paidOn: day(invoice.paidOn),
        description: invoice.description, amount: invoice.amount.toFixed(2), currency: invoice.currency, status: invoice.status,
      },
    }) as never,
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      stream.on('end', () => controller.close());
      stream.on('error', (err: Error) => controller.error(err));
    },
    cancel() {
      (stream as unknown as { destroy?: () => void }).destroy?.();
    },
  });
  return new Response(body, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${invoice.number.replace(/[^a-zA-Z0-9-]/g, '-')}.pdf"`, 'Cache-Control': 'no-store' },
  });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/subscription/invoices/[id]/pdf', _GET as H);

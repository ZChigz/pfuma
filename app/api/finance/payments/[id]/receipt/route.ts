// The printed receipt: A4, or narrow till paper (?size=80mm or 58mm), with a QR code that opens the public check page.
import { guarded } from '@/lib/finance/route';
import { getReceipt } from '@/lib/finance/payments';
import { pdfResponse } from '@/lib/students/pdf';
import { ReceiptDocument, type ReceiptSize } from '@/components/finance/pdf/Documents';
import { fetchPdfImage } from '@/lib/system/pdf-image';
import { qrDataUrl } from '@/lib/finance/downloads';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/payments/[id]/receipt', ['finance.payments.view', 'finance.payments.record', 'finance.payments.verify'], async ({ user, params, query, req }) => {
  const r = await getReceipt(user, params.id);
  const size = (['A4', '80mm', '58mm'] as const).includes(query.get('size') as ReceiptSize) ? (query.get('size') as ReceiptSize) : 'A4';
  const qr = await qrDataUrl(`${new URL(req.url).origin}/verify/receipt/${r.verifyCode}`);
  void fetchPdfImage;
  return pdfResponse(ReceiptDocument, { r, size, qr }, `receipt-${r.receiptNumber ?? r.ackNumber}.pdf`);
});

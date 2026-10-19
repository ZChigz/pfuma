// Gathers what a report card needs besides its data (logo, signature, photo, QR) and turns cards into one PDF.
import { createElement } from 'react';
import QRCode from 'qrcode';
import { renderToStream } from '@react-pdf/renderer';
import { fetchPdfImage } from '@/lib/system/pdf-image';
import { ReportCardsDocument, type CardAssets, type CardProps } from '@/components/exams/ExamReportCard';
import type { ReportCardData } from '@/lib/exams/publish';

/** The QR for a card: the public check page with its code. */
export function qrModules(url: string): boolean[][] {
  const q = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const n = q.modules.size;
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => q.modules.get(y, x) === 1));
}

/** Images that fail to load are simply left off; they never stop a report card. */
export async function cardAssets(cards: ReportCardData[], origin: string): Promise<CardProps[]> {
  const first = cards[0];
  const [logo, signature] = first ? await Promise.all([fetchPdfImage(first.school.logoUrl), fetchPdfImage(first.school.headSignatureUrl)]) : [null, null];
  const out: CardProps[] = [];
  for (let i = 0; i < cards.length; i += 8) {
    const batch = cards.slice(i, i + 8);
    const photos = await Promise.all(batch.map((c) => fetchPdfImage(c.student.photoUrl)));
    batch.forEach((card, j) => {
      const assets: CardAssets = { logo, signature, photo: photos[j] ?? null, qr: card.verificationCode ? qrModules(`${origin}/verify/${card.verificationCode}`) : null };
      out.push({ card, assets });
    });
  }
  return out;
}

export async function cardsPdf(cards: ReportCardData[], origin: string, filename: string): Promise<Response> {
  const props = await cardAssets(cards, origin);
  const stream = await renderToStream(createElement(ReportCardsDocument, { cards: props }) as never);
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
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '-')}"`, 'Cache-Control': 'no-store' },
  });
}

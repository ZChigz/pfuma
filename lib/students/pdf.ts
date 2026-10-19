// Turns a react-pdf document into a download. Used by every Student Information PDF.
import { createElement, type ComponentType } from 'react';
import { renderToStream } from '@react-pdf/renderer';

export async function pdfResponse<P extends object>(component: ComponentType<P>, props: P, filename: string): Promise<Response> {
  const stream = await renderToStream(createElement(component as ComponentType<object>, props) as never);
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
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '-')}"`,
      'Cache-Control': 'no-store',
    },
  });
}

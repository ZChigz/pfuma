// Loads a school's uploaded logo or signature so a PDF can draw it. A PDF cannot fall over
// because an image host is slow or gone, so every failure here just means "leave it out".

export interface PdfImage { data: Buffer; format: 'png' | 'jpg' }

/** Only images the school uploaded through UploadThing are fetched (never an arbitrary address). */
const UPLOADED = /^https:\/\/(utfs\.io|[a-z0-9-]+\.ufs\.sh)\//;
const MAX_BYTES = 1024 * 1024 + 4096;
const TIMEOUT_MS = 4000;

export async function fetchPdfImage(url: string | null | undefined, fetcher: typeof fetch = fetch): Promise<PdfImage | null> {
  if (!url || !UPLOADED.test(url)) return null;
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const format = type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : null;
    if (!format) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
    // The file must really be what it says, not just be labelled that way.
    const isPng = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if ((format === 'png' && !isPng) || (format === 'jpg' && !isJpg)) return null;
    return { data: bytes, format };
  } catch {
    return null;
  }
}

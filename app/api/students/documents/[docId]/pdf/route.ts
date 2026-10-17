import { requireSignedIn } from '@/lib/access';
import { withApi } from '@/lib/api';
import { letterSnapshot } from '@/lib/students/documents';
import { pdfResponse } from '@/lib/students/pdf';
import { fetchPdfImage } from '@/lib/system/pdf-image';
import { LetterDocument } from '@/components/students/pdf/LetterDocument';

export const runtime = 'nodejs';

// Print a saved letter again. It reads exactly as it did when it was issued, with the same reference number.
async function _GET(_req: Request, ctx?: unknown) {
  // The service decides: documents.view for a student's letters, admissions.view for an offer letter.
  const user = await requireSignedIn();
  const { docId } = (ctx as { params: { docId: string } }).params;
  const letter = await letterSnapshot(user, docId);
  const [logo, signature] = await Promise.all([fetchPdfImage(letter.school.logoUrl), fetchPdfImage(letter.school.headSignatureUrl)]);
  return pdfResponse(LetterDocument, { letter, logo, signature }, `${letter.referenceNo}.pdf`);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/documents/[docId]/pdf', _GET as H);

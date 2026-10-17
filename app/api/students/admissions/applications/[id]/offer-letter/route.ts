import { requirePermission } from '@/lib/access';
import { withApi } from '@/lib/api';
import { letterSnapshot } from '@/lib/students/documents';
import { offerLetterId } from '@/lib/students/admissions';
import { pdfResponse } from '@/lib/students/pdf';
import { fetchPdfImage } from '@/lib/system/pdf-image';
import { LetterDocument } from '@/components/students/pdf/LetterDocument';

export const runtime = 'nodejs';

// The offer letter as a PDF: school letterhead, reporting date, the requirements list and the Head's signature.
async function _GET(_req: Request, ctx?: unknown) {
  const user = await requirePermission('students.admissions.view');
  const { id } = (ctx as { params: { id: string } }).params;
  const doc = await offerLetterId(user, id);
  const letter = await letterSnapshot(user, doc.id);
  const [logo, signature] = await Promise.all([fetchPdfImage(letter.school.logoUrl), fetchPdfImage(letter.school.headSignatureUrl)]);
  return pdfResponse(LetterDocument, { letter, logo, signature }, `${letter.referenceNo}.pdf`);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/admissions/applications/[id]/offer-letter', _GET as H);

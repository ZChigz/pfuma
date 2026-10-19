import { requirePermission } from '@/lib/access';
import { withApi } from '@/lib/api';
import { profileForPrint } from '@/lib/students/class-list';
import { pdfResponse } from '@/lib/students/pdf';
import { fetchPdfImage } from '@/lib/system/pdf-image';
import { ProfileDocument } from '@/components/students/pdf/ProfileDocument';

export const runtime = 'nodejs';

// The student's profile as an A4 PDF for files and transfers: Overview, Guardians and Enrolment with the school header.
// Each section appears only if the person may see it. Printing is audit-logged.
async function _GET(_req: Request, ctx?: unknown) {
  const user = await requirePermission('students.profiles.view');
  const { id } = (ctx as { params: { id: string } }).params;
  const data = await profileForPrint(user, id);
  const logo = await fetchPdfImage(data.school.logoUrl);
  return pdfResponse(ProfileDocument, { data, logo }, `profile-${data.header.admissionNumber}.pdf`);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/[id]/print', _GET as H);

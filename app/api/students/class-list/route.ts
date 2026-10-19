import { requirePermission } from '@/lib/access';
import { withApi } from '@/lib/api';
import { classLists } from '@/lib/students/class-list';
import { pdfResponse } from '@/lib/students/pdf';
import { fetchPdfImage } from '@/lib/system/pdf-image';
import { ClassListDocument } from '@/components/students/pdf/ClassListDocument';

export const runtime = 'nodejs';

// An A4 class list per class: school header, class teacher, numbered names in alphabetical order by surname,
// boys and girls listed separately (separate=1) or together. Printing is audit-logged.
async function _GET(req: Request) {
  const user = await requirePermission('students.profiles.view');
  const q = new URL(req.url).searchParams;
  const classIds = (q.get('classIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const data = await classLists(user, classIds, { termId: q.get('termId') || undefined, separate: q.get('separate') === '1' });
  const logo = await fetchPdfImage(data.school.logoUrl);
  const name = data.pages.length === 1 ? data.pages[0]!.className : `${data.pages.length}-classes`;
  return pdfResponse(ClassListDocument, { data, logo }, `class-list-${name}.pdf`);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/class-list', _GET as H);

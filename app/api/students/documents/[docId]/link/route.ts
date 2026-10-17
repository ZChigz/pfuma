import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { documentLink } from '@/lib/students/documents';
import { signStudentFile } from '@/lib/students/storage';

// A link to an uploaded document that stops working after 10 minutes. Opening it is audit-logged.
async function _GET(_req: Request, ctx?: unknown) {
  const user = await requirePermission('students.documents.view');
  const { docId } = (ctx as { params: { docId: string } }).params;
  return apiSuccess(await documentLink(user, docId, signStudentFile));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/documents/[docId]/link', _GET as H);

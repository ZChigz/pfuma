import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { verifyLetter } from '@/lib/students/documents';

// Check a reference number printed on a letter: was it issued by this school, to whom, and when.
async function _GET(req: Request) {
  const user = await requirePermission('students.documents.view');
  const ref = new URL(req.url).searchParams.get('ref') ?? '';
  return apiSuccess(await verifyLetter(user, ref));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/documents/verify', _GET as H);

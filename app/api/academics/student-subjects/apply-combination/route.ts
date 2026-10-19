import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { applyCombination } from '@/lib/academics/student-subjects';

export const runtime = 'nodejs';

async function _POST(req: Request) {
  const user = await requirePermission('academics.student_subjects.manage');
  return apiSuccess(await applyCombination(user, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/student-subjects/apply-combination', _POST as H);

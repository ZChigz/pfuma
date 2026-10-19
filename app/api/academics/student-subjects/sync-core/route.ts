import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { syncCoreSubjects } from '@/lib/academics/student-subjects';

export const runtime = 'nodejs';

async function _POST(req: Request) {
  const user = await requirePermission('academics.student_subjects.manage');
  const b = (await readBody(req)) as { termId?: string; classId?: string };
  return apiSuccess(await syncCoreSubjects(user, b.termId, b.classId));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/student-subjects/sync-core', _POST as H);

import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { saveStudentChoices, studentSubjectGrid } from '@/lib/academics/student-subjects';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.classes.view');
  const q = new URL(req.url).searchParams;
  return apiSuccess(await studentSubjectGrid(user, q.get('classId') ?? '', q.get('termId') ?? undefined));
}

async function _PUT(req: Request) {
  const user = await requirePermission('academics.student_subjects.manage');
  return apiSuccess(await saveStudentChoices(user, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/student-subjects', _GET as H);
export const PUT = withApi('PUT /api/academics/student-subjects', _PUT as H);

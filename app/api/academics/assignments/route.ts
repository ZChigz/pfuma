import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { assignmentGrid, createAssignment, gapsReport, listAssignments, teacherWorkload } from '@/lib/academics/assignments';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.assignments.view');
  const q = new URL(req.url).searchParams;
  const view = q.get('view') ?? 'list';
  if (view === 'grid') return apiSuccess(await assignmentGrid(user, q.get('termId') ?? undefined));
  if (view === 'teachers') return apiSuccess(await teacherWorkload(user, q.get('termId') ?? undefined));
  if (view === 'gaps') return apiSuccess(await gapsReport(user, q.get('termId') ?? undefined));
  return apiSuccess(await listAssignments(user, { termId: q.get('termId') ?? undefined, classId: q.get('classId') ?? undefined, teacherId: q.get('teacherId') ?? undefined, includeEnded: q.get('ended') === '1' }));
}

async function _POST(req: Request) {
  const user = await requirePermission('academics.assignments.manage');
  return apiSuccess(await createAssignment(user, await readBody(req)), 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/assignments', _GET as H);
export const POST = withApi('POST /api/academics/assignments', _POST as H);

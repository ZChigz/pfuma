import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { studentDiscipline } from '@/lib/students/discipline';

// A student's incidents and the actions taken, newest first.
async function _GET(_req: Request, ctx?: unknown) {
  const user = await requirePermission('students.discipline.view');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess({ incidents: await studentDiscipline(user, id) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/[id]/discipline', _GET as H);

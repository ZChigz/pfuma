import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { RejoinSchema, rejoinStudent } from '@/lib/students/leavers';

const Body = RejoinSchema.omit({ studentId: true });

// Re-admit a former student on their old record: same admission number, same history.
async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.profiles.create');
  const { id } = (ctx as { params: { id: string } }).params;
  const body = await parseBody(req, Body);
  if ('error' in body) return body.error;
  return apiSuccess(await rejoinStudent(user, { ...body.data, studentId: id }));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/[id]/rejoin', _POST as H);

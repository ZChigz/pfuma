import { auth } from '@/lib/auth';
import { apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { canManageEnrollment } from '@/lib/permissions';
import { MoveStudentsSchema } from '@/lib/validations/academic';
import { transferClass } from '@/lib/students/lifecycle';
import type { SessionUser } from '@/types';

// Transfer class: changes the class in the open term's Enrollment only.
async function _POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageEnrollment(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, MoveStudentsSchema);
  if ('error' in parsed) return parsed.error;

  const result = await transferClass(user.schoolId, user.id, parsed.data.studentIds, parsed.data.classId);
  return apiSuccess(result);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/admin/students/move', _POST as H);

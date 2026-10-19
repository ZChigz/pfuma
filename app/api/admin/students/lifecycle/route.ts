import { auth } from '@/lib/auth';
import { requirePermission } from '@/lib/access';
import { apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { LifecycleActionSchema } from '@/lib/validations/academic';
import {
  graduateStudents,
  promoteStudents,
  repeatStudents,
  transferOutStudents,
  withdrawStudents,
} from '@/lib/students/lifecycle';
import type { SessionUser } from '@/types';

// Promote, repeat, graduate, transfer out or withdraw a batch of students.
async function _POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const parsed = await parseBody(req, LifecycleActionSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  // Superseded by the leaving process (/api/students/leaving) and the promotion wizard (/api/students/promotion).
  // Until those are the only way, these shortcuts are for the people who approve them: the Head.
  await requirePermission(body.action === 'PROMOTE' || body.action === 'REPEAT' ? 'students.promotion.approve' : 'students.leavers.approve');
  const { schoolId, id: actorId } = user;

  switch (body.action) {
    case 'PROMOTE':      return apiSuccess(await promoteStudents(schoolId, actorId, body));
    case 'REPEAT':       return apiSuccess(await repeatStudents(schoolId, actorId, body));
    case 'GRADUATE':     return apiSuccess(await graduateStudents(schoolId, actorId, body.studentIds, body.reason));
    case 'TRANSFER_OUT': return apiSuccess(await transferOutStudents(schoolId, actorId, body.studentIds, body.reason));
    case 'WITHDRAW':     return apiSuccess(await withdrawStudents(schoolId, actorId, body.studentIds, body.reason));
  }
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/admin/students/lifecycle', _POST as H);

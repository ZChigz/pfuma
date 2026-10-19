import { z } from 'zod';
import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { decideClassMove } from '@/lib/students/enrolment';

const Body = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(300).optional() });

// Approve or decline a class move that is waiting. The approver is recorded on the move.
async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.enrolment.approve');
  const { id } = (ctx as { params: { id: string } }).params;
  const body = await parseBody(req, Body);
  if ('error' in body) return body.error;
  return apiSuccess(await decideClassMove(user, id, body.data.decision, body.data.note));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/move/[id]', _POST as H);

import { z } from 'zod';
import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { MoveClassSchema, moveClass, pendingClassMoves } from '@/lib/students/enrolment';

const Body = z.object({ move: z.looseObject({}), dryRun: z.boolean().default(false) });

// Move one or many students to a class. `dryRun` returns the warnings (class full, new class size, whether
// approval is needed) without changing anything. Validation happens in the service with the full schema.
async function _POST(req: Request) {
  const user = await requirePermission('students.enrolment.manage');
  const body = await parseBody(req, Body);
  if ('error' in body) return body.error;
  const parsed = MoveClassSchema.safeParse(body.data.move);
  if (!parsed.success) {
    return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  return apiSuccess(await moveClass(user, parsed.data, { dryRun: body.data.dryRun }));
}

// Class moves waiting for approval.
async function _GET() {
  const user = await requirePermission('students.enrolment.view');
  return apiSuccess({ moves: await pendingClassMoves(user) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/move', _POST as H);
export const GET = withApi('GET /api/students/move', _GET as H);

import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { DecideActionSchema, decideAction } from '@/lib/students/discipline';

// The Head approves or rejects a suspension, or confirms or declines an expulsion recommendation
// (recording the decision date and any approval reference from the ministry or responsible authority).
async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.discipline.approve');
  const { id } = (ctx as { params: { id: string } }).params;
  let json: unknown;
  try { json = await req.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = DecideActionSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  return apiSuccess(await decideAction(user, id, parsed.data));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/discipline/actions/[id]', _POST as H);

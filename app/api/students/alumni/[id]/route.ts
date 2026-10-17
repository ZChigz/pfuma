import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { AlumnusSchema, updateAlumnus } from '@/lib/students/alumni';

// Update an alumnus: current phone and email, and what they went on to (further study, work).
async function _PATCH(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.leavers.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  let json: unknown;
  try { json = await req.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = AlumnusSchema.safeParse(json);
  if (!parsed.success) return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: parsed.error.flatten().fieldErrors }, { status: 422 });
  return apiSuccess(await updateAlumnus(user, id, json as never));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/students/alumni/[id]', _PATCH as H);

import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { AddGuardianSchema, addGuardianToStudent } from '@/lib/students/guardians';
import { profileGuardians } from '@/lib/students/profile';

// The Guardians tab. ID numbers only with students.guardians.view_ids.
async function _GET(_req: Request, ctx?: unknown) {
  const user = await requirePermission('students.guardians.view');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess({ guardians: await profileGuardians(user, id) });
}

// Add or link a guardian. Give guardianId to link someone already in the school, or the details to create one.
async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.guardians.edit');
  const { id } = (ctx as { params: { id: string } }).params;
  let json: unknown;
  try { json = await req.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = AddGuardianSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  await addGuardianToStudent(user, id, json as never);
  return apiSuccess({ linked: true }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/[id]/guardians', _GET as H);
export const POST = withApi('POST /api/students/[id]/guardians', _POST as H);

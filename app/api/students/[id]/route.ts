import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { fieldErrors } from '@/lib/students/registration';
import { profileHeader, profileOverview } from '@/lib/students/profile';
import { UpdateStudentSchema, updateStudent } from '@/lib/students/update';
import { visibleStudentTabs } from '@/lib/students/rules';

// The profile header (with the alert strip), the Overview tab and the list of tabs this user may open.
async function _GET(_req: Request, ctx?: unknown) {
  const user = await requirePermission('students.profiles.view');
  const { id } = (ctx as { params: { id: string } }).params;
  const [header, overview] = await Promise.all([profileHeader(user, id), profileOverview(user, id)]);
  return apiSuccess({ header, overview, tabs: visibleStudentTabs(user).map((t) => ({ key: t.key, label: t.label })) });
}

// Edit the student's own details. Admission number, status and class change only through their own actions.
async function _PATCH(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.profiles.edit');
  const { id } = (ctx as { params: { id: string } }).params;
  let json: unknown;
  try { json = await req.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = UpdateStudentSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: fieldErrors(parsed.error) }, { status: 422 });
  }
  return apiSuccess(await updateStudent(user, id, json as never));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/[id]', _GET as H);
export const PATCH = withApi('PATCH /api/students/[id]', _PATCH as H);

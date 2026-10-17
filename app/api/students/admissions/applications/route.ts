import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { fieldErrors } from '@/lib/students/registration';
import { ApplicationSchema, createApplication } from '@/lib/students/admissions';

// A new application (the student and guardian fields, the intake, results, test score and interview notes).
async function _POST(req: Request) {
  const user = await requirePermission('students.admissions.manage');
  let json: unknown;
  try { json = await req.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = ApplicationSchema.safeParse(json);
  if (!parsed.success) return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: fieldErrors(parsed.error) }, { status: 422 });
  const app = await createApplication(user, json as never);
  return apiSuccess({ id: app.id }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/admissions/applications', _POST as H);

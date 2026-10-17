import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { fieldErrors } from '@/lib/students/registration';
import { AdmitStudentSchema, checkAdmission } from '@/lib/students/admit';

// The review step: validates everything, and reports warnings, possible duplicates (with "Open existing"),
// guardians already in the school, and the admission number that will be used. Changes nothing.
async function _POST(req: Request) {
  const user = await requirePermission('students.profiles.create');
  let json: unknown;
  try { json = await req.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = AdmitStudentSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: fieldErrors(parsed.error) }, { status: 422 });
  }
  return apiSuccess(await checkAdmission(user, parsed.data));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/check', _POST as H);

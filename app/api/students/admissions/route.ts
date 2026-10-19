import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { IntakeSchema, listIntakes, saveIntake } from '@/lib/students/admissions';

// The intakes ("Form 1, 2027") with their places and how many applications, offers and enrolments each has.
async function _GET() {
  const user = await requirePermission('students.admissions.view');
  return apiSuccess({ intakes: await listIntakes(user) });
}

async function _POST(req: Request) {
  const user = await requirePermission('students.admissions.manage');
  let json: unknown;
  try { json = await req.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = IntakeSchema.safeParse(json);
  if (!parsed.success) return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: parsed.error.flatten().fieldErrors }, { status: 422 });
  const row = await saveIntake(user, json as never);
  return apiSuccess({ id: row.id }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/admissions', _GET as H);
export const POST = withApi('POST /api/students/admissions', _POST as H);

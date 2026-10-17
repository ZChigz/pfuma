import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { AddAlumnusSchema, AlumniQuerySchema, addAlumnus, listAlumni } from '@/lib/students/alumni';

// The alumni list: search by name, admission number or what they went on to, and filter by the year they left.
async function _GET(req: Request) {
  const user = await requirePermission('students.alumni.view');
  const f = AlumniQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  return apiSuccess(await listAlumni(user, f.success ? f.data : {}));
}

// Add a former student who did not complete O or A Level to the alumni by hand.
async function _POST(req: Request) {
  const user = await requirePermission('students.leavers.manage');
  const body = await parseBody(req, AddAlumnusSchema);
  if ('error' in body) return body.error;
  const a = await addAlumnus(user, body.data);
  return apiSuccess({ id: a.id }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/alumni', _GET as H);
export const POST = withApi('POST /api/students/alumni', _POST as H);

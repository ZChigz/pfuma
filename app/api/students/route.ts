import { z } from 'zod';
import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { fieldErrors } from '@/lib/students/registration';
import { AdmitStudentSchema, createStudent } from '@/lib/students/admit';
import { listStudents, parseStudentListQuery } from '@/lib/students/list';

// The Students list: search, filters, counts for the selected term and one page of rows.
// Guardian columns are empty for a user without students.guardians.view.
async function _GET(req: Request) {
  const user = await requirePermission('students.profiles.view');
  const query = parseStudentListQuery(new URL(req.url).searchParams);
  return apiSuccess(await listStudents(user, query));
}

const Body = z.object({ student: z.looseObject({}), acknowledgedWarnings: z.array(z.string().max(40)).max(10).default([]) });

// Add a student (the four-step form). Warnings must have been seen: send their codes in acknowledgedWarnings.
async function _POST(req: Request) {
  const user = await requirePermission('students.profiles.create');
  let json: unknown;
  try { json = await req.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400 }); }
  const body = Body.safeParse(json);
  if (!body.success) return Response.json({ success: false, message: 'Invalid request' }, { status: 400 });
  const parsed = AdmitStudentSchema.safeParse(body.data.student);
  if (!parsed.success) {
    return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: fieldErrors(parsed.error) }, { status: 422 });
  }
  return apiSuccess({ student: await createStudent(user, body.data.student as never, body.data.acknowledgedWarnings) }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students', _GET as H);
export const POST = withApi('POST /api/students', _POST as H);

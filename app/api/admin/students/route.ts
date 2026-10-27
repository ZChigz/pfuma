import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { requirePermission } from '@/lib/access';
import { studentScope } from '@/lib/students/scope';
import { getOpenTerm, requireTerm } from '@/lib/academic/terms';
import { fieldErrors, RegisterStudentRequestSchema, RegisterStudentSchema } from '@/lib/students/registration';
import { admitFromForm, checkRegistration } from '@/lib/students/server';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

// Students enrolled (ACTIVE) in a class or level for a term — the open term by default.
async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  // Superseded by /api/students: same permission, and only the students this user may reach.
  const access = await requirePermission('students.profiles.view');

  const { searchParams } = req.nextUrl;
  const classId = searchParams.get('classId') || undefined;
  const levelId = searchParams.get('levelId') || undefined;
  const termIdParam = searchParams.get('termId') || undefined;
  const term = termIdParam ? await requireTerm(user.schoolId, termIdParam, db) : await getOpenTerm(user.schoolId, db);
  if (!term) return apiSuccess({ students: [], termName: null });

  const enrollments = await db.enrollment.findMany({
    where: {
      schoolId: user.schoolId,
      termId: term.id,
      status: 'ACTIVE',
      ...(classId ? { classId } : {}),
      ...(levelId ? { class: { levelId } } : {}),
      student: await studentScope(access, term.id),
    },
    include: {
      student: { select: { id: true, admissionNumber: true, fullName: true, status: true } },
      class: { select: { id: true, name: true } },
    },
    orderBy: { student: { fullName: 'asc' } },
  });

  return apiSuccess({
    termName: term.name,
    students: enrollments.map((e) => ({ ...e.student, class: e.class })),
  });
}

// Admit a student from the Register Student form.
async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  // Superseded by /api/students; same permission and the same rules.
  await requirePermission('students.profiles.create');

  const body = await parseBody(req, RegisterStudentRequestSchema);
  if ('error' in body) return body.error;

  const parsed = RegisterStudentSchema.safeParse(body.data.student);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: 'Please fix the highlighted fields', errors: fieldErrors(parsed.error) },
      { status: 422 },
    );
  }
  const data = parsed.data;

  // Soft rules: the admin must have seen and accepted every warning.
  const check = await checkRegistration(user.schoolId, data, db);
  const acknowledged = new Set(body.data.acknowledgedWarnings);
  if (check.warnings.some((w) => !acknowledged.has(w.code))) {
    return NextResponse.json(
      { success: false, message: 'Please review the warnings before saving', warnings: check.warnings },
      { status: 409 },
    );
  }

  const student = await admitFromForm(
    user.schoolId,
    user.id,
    data,
    check.warnings.length ? `accepted warnings: ${check.warnings.map((w) => w.code).join(', ')}` : undefined,
  );
  return apiSuccess({ student }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/admin/students',  _GET  as H);
export const POST = withApi('POST /api/admin/students', _POST as H);

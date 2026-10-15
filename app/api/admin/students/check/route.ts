import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { canManageEnrollment } from '@/lib/permissions';
import { getScopedDb } from '@/lib/scoped-db';
import { requireOpenTerm } from '@/lib/academic/terms';
import { fieldErrors, RegisterStudentRequestSchema, RegisterStudentSchema } from '@/lib/students/registration';
import { checkRegistration } from '@/lib/students/server';
import type { SessionUser } from '@/types';

// Validates an admission without saving it and returns the cleaned data plus
// any warnings, for the confirmation screen.
async function _POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canManageEnrollment(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const body = await parseBody(req, RegisterStudentRequestSchema);
  if ('error' in body) return body.error;

  const parsed = RegisterStudentSchema.safeParse(body.data.student);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: 'Please fix the highlighted fields', errors: fieldErrors(parsed.error) },
      { status: 422 },
    );
  }

  await requireOpenTerm(user.schoolId, db);
  const check = await checkRegistration(user.schoolId, parsed.data, db);
  return apiSuccess({ student: parsed.data, ...check });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/admin/students/check', _POST as H);

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiError, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageStudents } from '@/lib/permissions';
import {
  fieldErrors,
  RegisterStudentRequestSchema,
  RegisterStudentSchema,
} from '@/lib/students/registration';
import {
  checkRegistration,
  findOrCreateClass,
  nextSequences,
  StudentNumberExhaustedError,
  studentRecord,
  takeStudentNumber,
  withStudentNumberRetry,
} from '@/lib/students/server';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const { searchParams } = req.nextUrl;
  const classId = searchParams.get('classId') || undefined;
  const grade   = searchParams.get('grade')   || undefined;

  const students = await prisma.student.findMany({
    where: {
      schoolId: user.schoolId,
      ...(classId ? { classId } : {}),
      ...(grade ? { grade } : {}),
    },
    include: {
      class: { select: { id: true, name: true, grade: true, section: true } },
    },
    orderBy: { fullName: 'asc' },
  });

  return apiSuccess({ students });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageStudents(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

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
  const check = await checkRegistration(user.schoolId, data);
  const acknowledged = new Set(body.data.acknowledgedWarnings);
  const unacknowledged = check.warnings.filter((w) => !acknowledged.has(w.code));
  if (unacknowledged.length > 0) {
    return NextResponse.json(
      { success: false, message: 'Please review the warnings before saving', warnings: check.warnings },
      { status: 409 },
    );
  }

  try {
    const student = await withStudentNumberRetry(() =>
      prisma.$transaction(async (tx) => {
        const schoolClass = await findOrCreateClass(tx, user.schoolId, user.id, data.form, data.stream);
        const sequences = await nextSequences(tx, user.schoolId, [data.enrollmentYear]);
        const studentNumber = takeStudentNumber(sequences, data.enrollmentYear);

        const s = await tx.student.create({
          data: studentRecord(user.schoolId, schoolClass.id, studentNumber, data),
          include: { class: { select: { id: true, name: true } } },
        });
        await logAudit(
          {
            schoolId:   user.schoolId,
            actorId:    user.id,
            action:     'CREATE_STUDENT',
            entityType: 'Student',
            entityId:   s.id,
            detail:     `${studentNumber} ${data.fullName} — ${schoolClass.name}`
              + (check.warnings.length ? ` (accepted warnings: ${check.warnings.map((w) => w.code).join(', ')})` : ''),
          },
          tx,
        );
        return s;
      }),
    );
    return apiSuccess({ student }, 201);
  } catch (e) {
    if (e instanceof StudentNumberExhaustedError) return apiError(e.message, 409);
    throw e;
  }
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/admin/students',  _GET  as unknown as H);
export const POST = withApi('POST /api/admin/students', _POST as H);

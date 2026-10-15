import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiError, apiForbidden, apiNotFound, apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { ReportCardDetailsSchema } from '@/lib/validations/results';
import { requireTerm } from '@/lib/academic/terms';
import { enrollmentFor } from '@/lib/academic/roster';
import type { SessionUser } from '@/types';

// Report-card extras for one student and term: the class teacher's remark, the
// Head's remark and days present / absent (all optional). The Head can set all of
// them; the class teacher of the student's class can set their own remark and the
// days, but not the Head's remark. Editable until the term is closed, also after
// the results are published (they are not grades).
async function _PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  const parsed = await parseBody(req, ReportCardDetailsSchema);
  if ('error' in parsed) return parsed.error;
  const { studentId, termId, ...fields } = parsed.data;

  const student = await db.student.findFirst({ where: { id: studentId, schoolId: user.schoolId }, select: { id: true, fullName: true } });
  if (!student) return apiNotFound('Student');
  const term = await requireTerm(user.schoolId, termId, db);
  if (term.status === 'CLOSED') return apiError(`${term.name} is closed, so its reports are locked. The Director can reopen the term.`, 409);

  const enrollment = await enrollmentFor(studentId, termId, db);
  if (!enrollment) return apiError(`${student.fullName} was not in a class in ${term.name}`, 422);
  const klass = await db.schoolClass.findFirst({ where: { id: enrollment.classId, schoolId: user.schoolId }, select: { classTeacherId: true } });

  const isHead = user.role === 'HEAD';
  const isClassTeacher = klass?.classTeacherId === user.id;
  if (!isHead && !isClassTeacher) return apiForbidden();
  if (fields.headRemark !== undefined && !isHead) return apiError("Only the Head can write the Head's remark", 403);

  const data = {
    ...(fields.classTeacherRemark !== undefined ? { classTeacherRemark: fields.classTeacherRemark || null } : {}),
    ...(fields.headRemark !== undefined ? { headRemark: fields.headRemark || null } : {}),
    ...(fields.daysPresent !== undefined ? { daysPresent: fields.daysPresent } : {}),
    ...(fields.daysAbsent !== undefined ? { daysAbsent: fields.daysAbsent } : {}),
  };

  const result = await db.$tx(async (tx) => {
    // Before the class is published there is no result row yet: keep the extras on an
    // unpublished placeholder that publishing fills in.
    const r = await tx.termResult.upsert({
      where: { studentId_termId: { studentId, termId } },
      update: data,
      create: { schoolId: user.schoolId, studentId, termId, totalMarks: 0, percentage: 0, published: false, ...data },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'UPDATE_REPORT_CARD',
        entityType: 'TermResult',
        entityId:   r.id,
        detail:     `${student.fullName} (${term.name}): ${Object.keys(data).join(', ')}`,
      },
      tx,
    );
    return r;
  });

  return apiSuccess({
    studentId,
    termId,
    classTeacherRemark: result.classTeacherRemark,
    headRemark: result.headRemark,
    daysPresent: result.daysPresent,
    daysAbsent: result.daysAbsent,
  });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/results/remarks', _PATCH as H);

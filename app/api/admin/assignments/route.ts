import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, apiError, apiNotFound, parseBody, withApi } from '@/lib/api';
import { canManageSubjects } from '@/lib/permissions';
import { CreateAssignmentSchema } from '@/lib/validations/results';
import { requireTerm } from '@/lib/academic/terms';
import { createAssignment, endAssignment, removeAssignment } from '@/lib/academics/assignments';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  const { searchParams } = new URL(req.url);
  const classId   = searchParams.get('classId')   ?? undefined;
  const teacherId = searchParams.get('teacherId') ?? undefined;
  const termId    = searchParams.get('termId')    ?? undefined;

  const assignments = await db.subjectAssignment.findMany({
    where: {
      schoolId: user.schoolId,
      ...(classId   ? { classId }   : {}),
      ...(teacherId ? { teacherId } : {}),
      ...(termId    ? { termId }    : {}),
    },
    include: {
      subject: { select: { id: true, name: true, code: true, maxMark: true } },
      class:   { select: { id: true, name: true } },
      teacher: { select: { id: true, fullName: true } },
      term:    { select: { id: true, name: true } },
    },
    orderBy: [{ class: { name: 'asc' } }, { subject: { name: 'asc' } }, { term: { startDate: 'desc' } }],
  });

  return apiSuccess({ assignments });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canManageSubjects(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, CreateAssignmentSchema);
  if ('error' in parsed) return parsed.error;
  const { teacherId, subjectId, classId, termId } = parsed.data;
  const term = await requireTerm(user.schoolId, termId, db);
  if (term.status === 'CLOSED') return apiError(`${term.name} is closed`, 409);

  const [teacher, subject, schoolClass] = await Promise.all([
    db.user.findUnique({ where: { id: teacherId } }),
    db.subject.findUnique({ where: { id: subjectId } }),
    db.schoolClass.findUnique({ where: { id: classId } }),
  ]);
  if (!teacher || teacher.schoolId !== user.schoolId) return apiError('Teacher not found in this school', 404);
  if (!subject || subject.schoolId !== user.schoolId) return apiNotFound('Subject');
  if (!schoolClass || schoolClass.schoolId !== user.schoolId) return apiNotFound('Class');

  const existing = await db.subjectAssignment.findUnique({
    where: { subjectId_classId_termId: { subjectId, classId, termId } },
  });
  if (existing) {
    return apiError(
      `${schoolClass.name} already has a teacher assigned for ${subject.name} in ${term.name}. Remove the existing assignment first.`,
      409,
    );
  }

  // The Academics module owns teacher assignments; the marks pages' own row (SubjectAssignment) is made by it.
  await createAssignment({ id: user.id, schoolId: user.schoolId, role: user.role }, { teacherId, subjectId, classId, termId, periodsPerWeek: 4 });
  const assignment = await db.subjectAssignment.findUniqueOrThrow({
    where: { subjectId_classId_termId: { subjectId, classId, termId } },
    include: {
      subject: { select: { id: true, name: true, code: true, maxMark: true } },
      class:   { select: { id: true, name: true } },
      teacher: { select: { id: true, fullName: true } },
    },
  });

  return apiSuccess({ assignment }, 201);
}

async function _DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canManageSubjects(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  let id = new URL(req.url).searchParams.get('id');
  if (!id) {
    const body = await req.json().catch(() => null) as { id?: string } | null;
    id = body?.id ?? null;
  }
  if (!id) return apiError('Assignment id is required', 400);

  const existing = await db.subjectAssignment.findUnique({ where: { id } });
  if (!existing || existing.schoolId !== user.schoolId) return apiNotFound('Assignment');

  // Remove the teacher assignment in the Academics module (or end it, once it has lessons or a scheme), then the marks row.
  const actor = { id: user.id, schoolId: user.schoolId, role: user.role };
  const live = await db.teacherAssignment.findFirst({ where: { termId: existing.termId, subjectId: existing.subjectId, classId: existing.classId, status: 'ACTIVE' }, select: { id: true } });
  if (live) {
    try { await removeAssignment(actor, live.id); } catch { await endAssignment(actor, live.id, {}); }
  }
  await db.subjectAssignment.deleteMany({ where: { id } });

  return apiSuccess({ deleted: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET    = withApi('GET /api/admin/assignments',    _GET    as H);
export const POST   = withApi('POST /api/admin/assignments',   _POST   as H);
export const DELETE = withApi('DELETE /api/admin/assignments', _DELETE as H);

import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, apiError, apiNotFound, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageClasses } from '@/lib/permissions';
import { UpdateClassSchema } from '@/lib/validations/admin';
import { classDisplayName, normalizeStream } from '@/lib/academic/rules';
import { getOpenTerm } from '@/lib/academic/terms';
import { PRIMARY_GUARDIAN_INCLUDE } from '@/lib/students/guardians';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

// Class details with its roster for the open term (from Enrollment).
async function _GET(_req: Request, ctx: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  const schoolClass = await db.schoolClass.findFirst({
    where: { id: ctx.params.id, schoolId: user.schoolId },
    include: { level: true, classTeacher: { select: { id: true, fullName: true } } },
  });
  if (!schoolClass) return apiNotFound('Class');

  const term = await getOpenTerm(user.schoolId, db);
  const enrollments = term
    ? await db.enrollment.findMany({
        where: { classId: schoolClass.id, termId: term.id, status: 'ACTIVE' },
        include: { student: { select: { id: true, admissionNumber: true, fullName: true, status: true, guardians: PRIMARY_GUARDIAN_INCLUDE } } },
        orderBy: { student: { fullName: 'asc' } },
      })
    : [];

  return apiSuccess({
    class: schoolClass,
    termName: term?.name ?? null,
    students: enrollments.map((e) => ({
      id: e.student.id,
      admissionNumber: e.student.admissionNumber,
      fullName: e.student.fullName,
      status: e.student.status,
      guardianName: e.student.guardians[0]?.guardian.fullName ?? null,
      guardianPhone: e.student.guardians[0]?.guardian.phone ?? null,
    })),
  });
}

async function _PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canManageClasses(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const existing = await db.schoolClass.findFirst({ where: { id: ctx.params.id, schoolId: user.schoolId } });
  if (!existing) return apiNotFound('Class');

  const parsed = await parseBody(req, UpdateClassSchema);
  if ('error' in parsed) return parsed.error;
  const { levelId, classTeacherId, active, capacity } = parsed.data;

  if (classTeacherId) {
    const teacher = await db.user.findUnique({ where: { id: classTeacherId } });
    if (!teacher || teacher.schoolId !== user.schoolId) return apiError('Class teacher not found in this school', 404);
  }

  const nextLevelId = levelId ?? existing.levelId;
  const nextStream = parsed.data.stream === undefined ? existing.stream : normalizeStream(parsed.data.stream);
  const level = await db.level.findFirst({ where: { id: nextLevelId, schoolId: user.schoolId } });
  if (!level) return apiError('Level not found', 404);
  const name = classDisplayName(level.name, nextStream);

  if (nextLevelId !== existing.levelId || nextStream !== existing.stream) {
    const dup = await db.schoolClass.findFirst({
      where: {
        schoolId: user.schoolId,
        id: { not: existing.id },
        OR: [{ name }, { levelId: nextLevelId, stream: { equals: nextStream, mode: 'insensitive' } }],
      },
    });
    if (dup) return apiError(`A class for ${name} already exists`, 409);
  }

  // Changing a class's level would rewrite the history of every term it was
  // used in; only allow it while the class has never had students.
  if (nextLevelId !== existing.levelId && await db.enrollment.count({ where: { classId: existing.id } }) > 0) {
    return apiError('This class already has students in its history, so its level cannot change. Create a new class instead.', 409);
  }

  const updated = await db.$tx(async (tx) => {
    const c = await tx.schoolClass.update({
      where: { id: existing.id },
      data: {
        name,
        levelId: nextLevelId,
        stream: nextStream,
        ...(capacity !== undefined ? { capacity } : {}),
        ...(classTeacherId !== undefined ? { classTeacherId } : {}),
        ...(active !== undefined ? { active } : {}),
      },
    });
    await logAudit(
      { schoolId: user.schoolId, actorId: user.id, action: 'UPDATE_CLASS', entityType: 'SchoolClass', entityId: c.id, detail: `${name}${capacity !== undefined ? `, capacity ${capacity}` : ''}` },
      tx,
    );
    return c;
  });

  return apiSuccess({ class: updated });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET   = withApi('GET /api/admin/classes/[id]',   _GET   as unknown as H);
export const PATCH = withApi('PATCH /api/admin/classes/[id]', _PATCH as unknown as H);

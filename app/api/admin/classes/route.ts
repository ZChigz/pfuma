import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiError, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageClasses } from '@/lib/permissions';
import { CreateClassSchema } from '@/lib/validations/admin';
import { classDisplayName, normalizeStream } from '@/lib/academic/rules';
import { getOpenTerm } from '@/lib/academic/terms';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _GET() {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const term = await getOpenTerm(user.schoolId);
  const classes = await prisma.schoolClass.findMany({
    where: { schoolId: user.schoolId },
    include: {
      level: { select: { id: true, name: true, order: true } },
      classTeacher: { select: { id: true, fullName: true } },
      _count: { select: { enrollments: { where: { termId: term?.id ?? '', status: 'ACTIVE' } } } },
    },
    orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }],
  });

  return apiSuccess({
    termName: term?.name ?? null,
    classes: classes.map((c) => ({
      id: c.id,
      name: c.name,
      level: c.level,
      stream: c.stream,
      capacity: c.capacity,
      active: c.active,
      classTeacher: c.classTeacher,
      studentCount: c._count.enrollments,
    })),
  });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageClasses(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, CreateClassSchema);
  if ('error' in parsed) return parsed.error;
  const { levelId, classTeacherId } = parsed.data;
  const stream = normalizeStream(parsed.data.stream ?? '');

  const [level, school] = await Promise.all([
    prisma.level.findFirst({ where: { id: levelId, schoolId: user.schoolId } }),
    prisma.school.findUnique({ where: { id: user.schoolId }, select: { maxClassSize: true } }),
  ]);
  if (!level) return apiError('Level not found', 404);

  const name = classDisplayName(level.name, stream);
  const existing = await prisma.schoolClass.findFirst({
    where: { schoolId: user.schoolId, OR: [{ name }, { levelId, stream: { equals: stream, mode: 'insensitive' } }] },
  });
  if (existing) return apiError(`A class for ${name} already exists`, 409);

  if (classTeacherId) {
    const teacher = await prisma.user.findUnique({ where: { id: classTeacherId } });
    if (!teacher || teacher.schoolId !== user.schoolId) return apiError('Class teacher not found in this school', 404);
  }

  const created = await prisma.$transaction(async (tx) => {
    const schoolClass = await tx.schoolClass.create({
      data: {
        schoolId: user.schoolId,
        name,
        levelId,
        stream,
        capacity: parsed.data.capacity ?? school?.maxClassSize ?? 45,
        classTeacherId: classTeacherId || null,
      },
    });
    await logAudit(
      { schoolId: user.schoolId, actorId: user.id, action: 'CREATE_CLASS', entityType: 'SchoolClass', entityId: schoolClass.id, detail: name },
      tx,
    );
    return schoolClass;
  });

  return apiSuccess({ class: created }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/admin/classes',  _GET  as H);
export const POST = withApi('POST /api/admin/classes', _POST as H);

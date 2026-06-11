import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiError, withApi } from '@/lib/api';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const { searchParams } = new URL(req.url);
  const teacherId = searchParams.get('teacherId');
  const term      = searchParams.get('term');
  if (!teacherId || !term) return apiError('teacherId and term are required', 400);

  const assignments = await prisma.subjectAssignment.findMany({
    where: { schoolId: user.schoolId, teacherId, term },
    include: {
      subject: { select: { id: true, name: true, code: true } },
      class:   { select: { id: true, name: true } },
    },
    orderBy: [{ class: { name: 'asc' } }, { subject: { name: 'asc' } }],
  });

  return apiSuccess({ assignments, totalClasses: assignments.length });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/admin/assignments/teacher-load', _GET as H);

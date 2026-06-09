import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, withApi } from '@/lib/api';
import type { SessionUser } from '@/types';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const { searchParams } = req.nextUrl;
  const q = searchParams.get('q') || undefined;

  const members = await prisma.libraryMember.findMany({
    where: {
      schoolId: user.schoolId,
      ...(q ? { user: { fullName: { contains: q, mode: 'insensitive' } } } : {}),
    },
    include: {
      user: { select: { id: true, fullName: true, role: true } },
      _count: { select: { borrowings: { where: { returnDate: null } } } },
    },
    orderBy: { user: { fullName: 'asc' } },
  });

  return apiSuccess({ members });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/library/members', _GET as H);

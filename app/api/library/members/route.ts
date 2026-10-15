import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, withApi } from '@/lib/api';
import { memberName } from '@/lib/library';
import type { SessionUser } from '@/types';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  const { searchParams } = req.nextUrl;
  const q = searchParams.get('q') || undefined;

  const members = await db.libraryMember.findMany({
    where: {
      schoolId: user.schoolId,
      ...(q ? { OR: [
        { user:    { fullName: { contains: q, mode: 'insensitive' } } },
        { student: { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { admissionNumber: { contains: q, mode: 'insensitive' } }] } },
      ] } : {}),
    },
    include: {
      user: { select: { id: true, fullName: true, role: true } },
      student: { select: { id: true, fullName: true, admissionNumber: true, status: true } },
      _count: { select: { borrowings: { where: { returnDate: null } } } },
    },
    orderBy: { memberType: 'asc' },
  });

  return apiSuccess({
    members: members
      .map((m) => ({
        ...m,
        name: memberName(m),
        detail: m.memberType === 'STUDENT' ? `Student ${m.student?.admissionNumber ?? ''}`.trim() : m.user?.role ?? 'Staff',
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/library/members', _GET as H);

import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canManageLibrary } from '@/lib/permissions';
import { parseBody, apiSuccess, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { z } from 'zod';
import type { SessionUser } from '@/types';

const UpdateCopySchema = z.object({
  condition: z.enum(['NEW', 'GOOD', 'FAIR', 'DAMAGED']).optional(),
  status:    z.enum(['AVAILABLE', 'BORROWED', 'LOST']).optional(),
});

async function _PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageLibrary(user.role); } catch (res) { return res as Response; }

  const existing = await prisma.bookCopy.findFirst({
    where:   { id: params.id, schoolId: user.schoolId },
    include: { borrowings: { where: { returnDate: null }, select: { id: true } } },
  });
  if (!existing) return apiNotFound('Book copy');

  const parsed = await parseBody(req, UpdateCopySchema);
  if ('error' in parsed) return parsed.error;

  const copy = await prisma.$transaction(async (tx) => {
    const c = await tx.bookCopy.update({
      where: { id: params.id },
      data: {
        ...(parsed.data.condition !== undefined ? { condition: parsed.data.condition } : {}),
        ...(parsed.data.status    !== undefined ? { status:    parsed.data.status    } : {}),
      },
    });
    // If marking LOST and an open borrowing exists, close it
    if (parsed.data.status === 'LOST' && existing.borrowings.length > 0) {
      await tx.borrowing.updateMany({
        where: { copyId: params.id, returnDate: null },
        data:  { returnDate: new Date(), conditionOnReturn: 'DAMAGED' },
      });
    }
    return c;
  });

  return apiSuccess({ copy });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/library/copies/[id]', _PATCH as H);

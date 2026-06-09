import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canManageLibrary } from '@/lib/permissions';
import { parseBody, apiSuccess, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { z } from 'zod';
import type { SessionUser } from '@/types';

const UpdateBookSchema = z.object({
  isbn:          z.string().optional(),
  title:         z.string().min(1).optional(),
  author:        z.string().min(1).optional(),
  subject:       z.string().optional(),
  publisher:     z.string().optional(),
  year:          z.number().int().optional(),
  shelfLocation: z.string().optional(),
  coverUrl:      z.string().url().optional().or(z.literal('')),
});

async function _GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const book = await prisma.book.findFirst({
    where: { id: params.id, schoolId: user.schoolId },
    include: {
      copies: {
        include: {
          borrowings: {
            where:   { returnDate: null },
            include: { member: { include: { user: { select: { fullName: true } } } } },
          },
        },
        orderBy: { accessionNumber: 'asc' },
      },
    },
  });
  if (!book) return apiNotFound('Book');

  return apiSuccess({ book });
}

async function _PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageLibrary(user.role); } catch (res) { return res as Response; }

  const existing = await prisma.book.findFirst({
    where: { id: params.id, schoolId: user.schoolId },
  });
  if (!existing) return apiNotFound('Book');

  const parsed = await parseBody(req, UpdateBookSchema);
  if ('error' in parsed) return parsed.error;

  const book = await prisma.book.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.isbn          !== undefined ? { isbn:          parsed.data.isbn          || null } : {}),
      ...(parsed.data.title         !== undefined ? { title:         parsed.data.title                 } : {}),
      ...(parsed.data.author        !== undefined ? { author:        parsed.data.author                } : {}),
      ...(parsed.data.subject       !== undefined ? { subject:       parsed.data.subject       || null } : {}),
      ...(parsed.data.publisher     !== undefined ? { publisher:     parsed.data.publisher     || null } : {}),
      ...(parsed.data.year          !== undefined ? { year:          parsed.data.year          ?? null } : {}),
      ...(parsed.data.shelfLocation !== undefined ? { shelfLocation: parsed.data.shelfLocation || null } : {}),
      ...(parsed.data.coverUrl      !== undefined ? { coverUrl:      parsed.data.coverUrl      || null } : {}),
    },
  });

  return apiSuccess({ book });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET   = withApi('GET /api/library/books/[id]',   _GET   as H);
export const PATCH = withApi('PATCH /api/library/books/[id]', _PATCH as H);

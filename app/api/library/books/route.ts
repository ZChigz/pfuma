import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { canManageLibrary } from '@/lib/permissions';
import { parseBody, apiSuccess, apiUnauthorized, withApi } from '@/lib/api';
import { CreateBookSchema } from '@/lib/validations/library';
import type { SessionUser } from '@/types';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const { searchParams } = req.nextUrl;
  const q         = searchParams.get('q')         || undefined;
  const available = searchParams.get('available') === 'true';

  const books = await prisma.book.findMany({
    where: {
      schoolId: user.schoolId,
      ...(q ? {
        OR: [
          { title:  { contains: q, mode: 'insensitive' } },
          { author: { contains: q, mode: 'insensitive' } },
          { isbn:   { contains: q, mode: 'insensitive' } },
          { copies: { some: { accessionNumber: { contains: q, mode: 'insensitive' } } } },
        ],
      } : {}),
    },
    include: {
      copies: {
        select: { id: true, accessionNumber: true, condition: true, status: true },
      },
    },
    orderBy: { title: 'asc' },
  });

  const result = books
    .map((b) => ({
      ...b,
      availableCopiesCount: b.copies.filter((c) => c.status === 'AVAILABLE').length,
    }))
    .filter((b) => !available || b.availableCopiesCount > 0);

  return apiSuccess({ books: result });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageLibrary(user.role); } catch (res) { return res as Response; }

  const parsed = await parseBody(req, CreateBookSchema);
  if ('error' in parsed) return parsed.error;

  const currentYear = new Date().getFullYear();

  const { book, copies } = await prisma.$transaction(async (tx) => {
    const b = await tx.book.create({
      data: {
        schoolId:     user.schoolId,
        isbn:          parsed.data.isbn          || null,
        title:         parsed.data.title,
        author:        parsed.data.author,
        subject:       parsed.data.subject       || null,
        publisher:     parsed.data.publisher     || null,
        year:          parsed.data.year          ?? null,
        shelfLocation: parsed.data.shelfLocation || null,
        coverUrl:      parsed.data.coverUrl      || null,
        totalCopies:   parsed.data.totalCopies,
      },
    });

    const existingCount = await tx.bookCopy.count({ where: { schoolId: user.schoolId } });

    const cs = [];
    for (let i = 0; i < parsed.data.totalCopies; i++) {
      const copy = await tx.bookCopy.create({
        data: {
          schoolId:        user.schoolId,
          bookId:          b.id,
          accessionNumber: `SCH-${currentYear}-${String(existingCount + i + 1).padStart(4, '0')}`,
        },
      });
      cs.push(copy);
    }

    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'CREATE_ASSET',
        entityType: 'Book',
        entityId:   b.id,
        detail:     `${b.title} by ${b.author} (${parsed.data.totalCopies} copies)`,
      },
      tx,
    );

    return { book: b, copies: cs };
  });

  return apiSuccess({ book, copies }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/library/books',  _GET  as H);
export const POST = withApi('POST /api/library/books', _POST as H);

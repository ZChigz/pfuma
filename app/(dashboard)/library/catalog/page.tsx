import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { CatalogClient } from '@/components/library/CatalogClient';
import type { SessionUser } from '@/types';

export default async function CatalogPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;

  const books = await prisma.book.findMany({
    where: { schoolId: user.schoolId },
    include: {
      copies: {
        select: { id: true, accessionNumber: true, condition: true, status: true },
      },
    },
    orderBy: { title: 'asc' },
  });

  const serialized = books.map((b) => ({
    ...b,
    availableCopiesCount: b.copies.filter((c) => c.status === 'AVAILABLE').length,
  }));

  return <CatalogClient initialBooks={serialized} userRole={user.role} />;
}

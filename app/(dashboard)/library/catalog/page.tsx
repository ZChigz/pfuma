import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import { CatalogClient } from '@/components/library/CatalogClient';
import type { SessionUser } from '@/types';

export default async function CatalogPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  const books = await db.book.findMany({
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

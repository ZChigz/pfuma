import { auth } from '@/lib/auth';
import { guardPage } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import { copyCounts } from '@/lib/library';
import { CatalogClient } from '@/components/library/CatalogClient';
import type { SessionUser } from '@/types';

export default async function CatalogPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  await guardPage(user, 'facilities.library.view');

  const books = await db.book.findMany({
    where: { schoolId: user.schoolId },
    include: {
      copies: {
        select: { id: true, accessionNumber: true, condition: true, status: true },
      },
    },
    orderBy: { title: 'asc' },
  });

  const counts = await copyCounts(db, books.map((b) => b.id));
  const serialized = books.map((b) => ({
    ...b,
    replacementCost: b.replacementCost?.toNumber() ?? null,
    availableCopiesCount: counts.get(b.id)?.available ?? 0,
    copyCounts: counts.get(b.id)!,
  }));

  return <CatalogClient initialBooks={serialized} />;
}

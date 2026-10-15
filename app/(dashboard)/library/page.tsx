import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import { LibraryOverviewClient } from '@/components/library/LibraryOverviewClient';
import { getDaysOverdue } from '@/lib/utils';
import type { SessionUser } from '@/types';

export default async function LibraryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  const { schoolId, role } = user;

  const now = new Date();

  const [totalTitles, borrowedCount, overdueCount, availableAgg, overdueRaw] =
    await Promise.all([
      db.book.count({ where: { schoolId } }),
      db.borrowing.count({ where: { schoolId, returnDate: null } }),
      db.borrowing.count({ where: { schoolId, returnDate: null, dueDate: { lt: now } } }),
      db.bookCopy.aggregate({
        where: { schoolId, status: 'AVAILABLE' },
        _count: { id: true },
      }),
      db.borrowing.findMany({
        where:   { schoolId, returnDate: null, dueDate: { lt: now } },
        include: {
          member: { include: { user: { select: { fullName: true } } } },
          copy:   { include: { book: { select: { title: true } } } },
        },
        orderBy: { dueDate: 'asc' },
        take:    15,
      }),
    ]);

  const overdueList = overdueRaw.map((b) => ({
    id:          b.id,
    bookTitle:   b.copy.book.title,
    accession:   b.copy.accessionNumber,
    memberName:  b.member.user.fullName,
    dueDate:     b.dueDate.toISOString(),
    daysOverdue: getDaysOverdue(b.dueDate),
  }));

  return (
    <LibraryOverviewClient
      stats={{
        totalTitles,
        available: availableAgg._count.id,
        borrowed:  borrowedCount,
        overdue:   overdueCount,
      }}
      overdueList={overdueList}
      userRole={role}
    />
  );
}

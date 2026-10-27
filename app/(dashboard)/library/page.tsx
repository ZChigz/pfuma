import { auth } from '@/lib/auth';
import { guardPage } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import { LibraryOverviewClient } from '@/components/library/LibraryOverviewClient';
import { memberName } from '@/lib/library';
import { getDaysOverdue } from '@/lib/utils';
import type { SessionUser } from '@/types';

export default async function LibraryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  await guardPage(user, 'facilities.library.view');
  const { schoolId } = user;

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
          member: { include: { user: { select: { fullName: true } }, student: { select: { fullName: true } } } },
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
    memberName:  memberName(b.member),
    dueDate:     b.dueDate.toISOString(),
    daysOverdue: getDaysOverdue(b.dueDate),
  }));

  const school = await db.school.findUnique({ where: { id: schoolId }, select: { libraryFineLimit: true, studentLoanLimit: true, staffLoanLimit: true } });

  return (
    <LibraryOverviewClient
      stats={{
        totalTitles,
        available: availableAgg._count.id,
        borrowed:  borrowedCount,
        overdue:   overdueCount,
      }}
      overdueList={overdueList}
      settings={{
        libraryFineLimit: school?.libraryFineLimit.toNumber() ?? 5,
        studentLoanLimit: school?.studentLoanLimit ?? 2,
        staffLoanLimit: school?.staffLoanLimit ?? 5,
      }}
    />
  );
}

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { LibraryOverviewClient } from '@/components/library/LibraryOverviewClient';
import { getDaysOverdue } from '@/lib/utils';
import type { SessionUser } from '@/types';

export default async function LibraryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const { schoolId, role } = user;

  const now = new Date();

  const [totalTitles, borrowedCount, overdueCount, availableAgg, overdueRaw] =
    await Promise.all([
      prisma.book.count({ where: { schoolId } }),
      prisma.borrowing.count({ where: { schoolId, returnDate: null } }),
      prisma.borrowing.count({ where: { schoolId, returnDate: null, dueDate: { lt: now } } }),
      prisma.bookCopy.aggregate({
        where: { schoolId, status: 'AVAILABLE' },
        _count: { id: true },
      }),
      prisma.borrowing.findMany({
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

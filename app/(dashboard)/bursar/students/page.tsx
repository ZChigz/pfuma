import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { BursarStudentsTable } from '@/components/accounting/BursarStudentsTable';
import type { SessionUser } from '@/types';

export default async function BursarStudentsPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'BURSAR') redirect('/');

  const q = searchParams.q?.trim() ?? '';

  const rows = await prisma.student.findMany({
    where: {
      schoolId: user.schoolId,
      active: true,
      ...(q ? { fullName: { contains: q, mode: 'insensitive' } } : {}),
    },
    include: {
      class: { select: { name: true } },
      charges: { select: { currency: true, amount: true } },
      payments: { where: { status: 'VERIFIED' }, select: { currency: true, amount: true } },
    },
    orderBy: { fullName: 'asc' },
  });

  const students = rows.map((s) => {
    const cUSD = s.charges.filter((c) => c.currency === 'USD').reduce((n, c) => n + c.amount.toNumber(), 0);
    const pUSD = s.payments.filter((p) => p.currency === 'USD').reduce((n, p) => n + p.amount.toNumber(), 0);
    const cZiG = s.charges.filter((c) => c.currency === 'ZIG').reduce((n, c) => n + c.amount.toNumber(), 0);
    const pZiG = s.payments.filter((p) => p.currency === 'ZIG').reduce((n, p) => n + p.amount.toNumber(), 0);

    return {
      id: s.id,
      fullName: s.fullName,
      grade: s.grade,
      className: s.class?.name ?? s.grade,
      parentPhone: s.parentPhone,
      balanceUSD: cUSD - pUSD,
      balanceZiG: cZiG - pZiG,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#292524]">Record a payment</h1>
        <p className="mt-0.5 text-sm text-[#78716c]">Search for a student to record a fee payment</p>
      </div>

      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search student by name"
          className="min-h-[44px] w-full max-w-sm rounded-md border border-[#e7e5e4] bg-white px-3 text-sm text-[#292524] focus:outline-none focus:ring-2 focus:ring-[#065f46]/30"
        />
        <button
          type="submit"
          className="min-h-[44px] rounded-md border border-[#e7e5e4] bg-white px-4 text-sm font-medium text-[#292524] hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#065f46]/40"
        >
          Search
        </button>
      </form>

      <BursarStudentsTable students={students} />
    </div>
  );
}

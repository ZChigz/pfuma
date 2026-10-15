import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import { BursarStudentsTable } from '@/components/accounting/BursarStudentsTable';
import { PRIMARY_GUARDIAN_INCLUDE } from '@/lib/students/guardians';
import type { SessionUser } from '@/types';

export default async function BursarStudentsPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  if (user.role !== 'BURSAR') redirect('/');

  const q = searchParams.q?.trim() ?? '';

  const rows = await db.student.findMany({
    where: {
      schoolId: user.schoolId,
      status: 'ACTIVE',
      ...(q ? { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { admissionNumber: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    include: {
      currentClass: { select: { name: true, level: { select: { name: true } } } },
      guardians: PRIMARY_GUARDIAN_INCLUDE,
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
      grade: s.currentClass?.name ?? '',
      className: s.currentClass?.name ?? '—',
      parentPhone: s.guardians[0]?.guardian.phone ?? '',
      balanceUSD: cUSD - pUSD,
      balanceZiG: cZiG - pZiG,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Record a payment</h1>
        <p className="mt-1 text-sm text-muted">Search for a student to record a fee payment</p>
      </div>

      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name or admission number"
          className="min-h-[44px] w-full max-w-sm rounded-xl border border-line bg-white px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          type="submit"
          className="min-h-[44px] rounded-xl border border-line bg-white px-4 text-sm font-medium text-ink hover:bg-rowhover focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          Search
        </button>
      </form>

      <BursarStudentsTable students={students} />
    </div>
  );
}

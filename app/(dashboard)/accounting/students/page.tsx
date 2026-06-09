import { Suspense } from 'react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { getDaysOverdue } from '@/lib/utils';
import { Permission } from '@/lib/permissions';
import { StudentsFilters } from '@/components/accounting/StudentsFilters';
import { StudentsTableClient } from '@/components/accounting/StudentsTableClient';
import { AddStudentModal } from '@/components/accounting/AddStudentModal';
import type { SessionUser } from '@/types';
import type { StudentRow } from '@/components/accounting/StudentsTableClient';

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: { status?: string; grade?: string; q?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;

  const { status: statusFilter, grade, q } = searchParams;

  const rows = await prisma.student.findMany({
    where: {
      schoolId: user.schoolId,
      active: true,
      ...(grade ? { grade } : {}),
      ...(q ? { fullName: { contains: q, mode: 'insensitive' } } : {}),
    },
    include: {
      charges: { select: { currency: true, amount: true, issuedAt: true } },
      payments: {
        where: { status: 'VERIFIED' },
        select: { currency: true, amount: true },
      },
    },
    orderBy: { fullName: 'asc' },
  });

  const allStudents: StudentRow[] = rows.map((s) => {
    const cUSD = s.charges.filter(c => c.currency === 'USD').reduce((n, c) => n + c.amount.toNumber(), 0);
    const cZiG = s.charges.filter(c => c.currency === 'ZIG').reduce((n, c) => n + c.amount.toNumber(), 0);
    const pUSD = s.payments.filter(p => p.currency === 'USD').reduce((n, p) => n + p.amount.toNumber(), 0);
    const pZiG = s.payments.filter(p => p.currency === 'ZIG').reduce((n, p) => n + p.amount.toNumber(), 0);
    const balanceUSD = cUSD - pUSD;
    const balanceZiG = cZiG - pZiG;
    const hasBalance = balanceUSD > 0 || balanceZiG > 0;
    const earliest =
      s.charges.length > 0
        ? s.charges.reduce((min, c) => (c.issuedAt < min ? c.issuedAt : min), s.charges[0].issuedAt)
        : null;
    const overdueDays = hasBalance && earliest ? getDaysOverdue(earliest) : 0;
    return {
      id: s.id,
      fullName: s.fullName,
      grade: s.grade,
      parentName: s.parentName,
      parentPhone: s.parentPhone,
      balanceUSD,
      balanceZiG,
      overdueDays,
    };
  });

  // Summary counts are always from the full (un-status-filtered) dataset
  const totalOwing   = allStudents.filter(s => s.balanceUSD > 0 || s.balanceZiG > 0).length;
  const totalCleared = allStudents.filter(s => s.balanceUSD <= 0 && s.balanceZiG <= 0).length;

  // Apply status filter for the table
  const students =
    statusFilter === 'cleared'
      ? allStudents.filter(s => s.balanceUSD <= 0 && s.balanceZiG <= 0)
      : statusFilter === 'owing'
        ? allStudents.filter(s => s.balanceUSD > 0 || s.balanceZiG > 0)
        : statusFilter === 'overdue30'
          ? allStudents.filter(s => s.overdueDays >= 30)
          : allStudents;

  const canManage = Permission.manageStudents.includes(user.role);

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#292524]">Students & Fees</h1>
          <p className="mt-0.5 text-sm text-[#78716c]">Manage student accounts and fee balances</p>
        </div>
        {canManage && <AddStudentModal />}
      </div>

      {/* Summary bar */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <StatCard label="Total Students" value={allStudents.length} color="text-[#292524]" />
        <StatCard label="Owing"          value={totalOwing}         color="text-[#b91c1c]" />
        <StatCard label="Cleared"        value={totalCleared}       color="text-[#15803d]" />
      </div>

      <Suspense fallback={null}>
        <StudentsFilters currentStatus={statusFilter} currentQ={q} />
      </Suspense>
      <StudentsTableClient students={students} canManage={canManage} />
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-[#e7e5e4] bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[#78716c]">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

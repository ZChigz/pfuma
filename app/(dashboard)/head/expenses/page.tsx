import { StatCard } from '@/components/ui/StatCard';
import { Suspense } from 'react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Permission } from '@/lib/permissions';
import { formatUSD, formatZiG, formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { LogExpenseModal } from '@/components/accounting/LogExpenseModal';
import { ExpenseFilters } from '@/components/accounting/ExpenseFilters';
import { ExpenseVoidButton } from '@/components/accounting/ExpenseVoidButton';
import type { SessionUser } from '@/types';
import type { Prisma } from '@prisma/client';

type ExpenseRow = Prisma.ExpenseGetPayload<{
  include: {
    recorder: { select: { fullName: true } };
    voider:   { select: { fullName: true } };
  };
}>;

export default async function HeadExpensesPage({
  searchParams,
}: {
  searchParams: { currency?: string; category?: string; from?: string; to?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'HEAD') redirect('/');

  const { currency, category, from, to } = searchParams;

  const expenses: ExpenseRow[] = await prisma.expense.findMany({
    where: {
      schoolId: user.schoolId,
      ...(currency ? { currency: currency as never } : {}),
      ...(category ? { category }                    : {}),
      ...(from || to
        ? {
            spentOn: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to   ? { lte: new Date(to)   } : {}),
            },
          }
        : {}),
    },
    include: {
      recorder: { select: { fullName: true } },
      voider:   { select: { fullName: true } },
    },
    orderBy: { spentOn: 'desc' },
  });

  const canVoid = Permission.voidExpense.includes(user.role);

  // Summary
  const totalUSD = expenses
    .filter(e => e.currency === 'USD' && e.status === 'ACTIVE')
    .reduce((n, e) => n + e.amount.toNumber(), 0);
  const totalZiG = expenses
    .filter(e => e.currency === 'ZIG' && e.status === 'ACTIVE')
    .reduce((n, e) => n + e.amount.toNumber(), 0);

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Expenses</h1>
          <p className="mt-1 text-sm text-muted">Track and manage school expenditure</p>
        </div>
        <LogExpenseModal />
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <StatCard hero label="Total spent (USD, active)" value={formatUSD(totalUSD)} />
        <StatCard label="Total spent (ZiG, active)" value={formatZiG(totalZiG)} />
      </div>

      {/* Filters */}
      <Suspense fallback={null}>
        <ExpenseFilters
          currentCurrency={currency}
          currentCategory={category}
          currentFrom={from}
          currentTo={to}
        />
      </Suspense>

      {/* Table */}
      {expenses.length === 0 ? (
        <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
          No expenses recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white">
          <table className="w-full text-left text-sm text-ink">
            <thead className="border-b border-line bg-white">
              <tr>
                {['Date', 'Category', 'Note', 'Currency', 'Amount', 'Recorded By', 'Status', ...(canVoid ? [''] : [])].map(
                  (h, i) => (
                    <th
                      key={i}
                      className="px-4 py-3.5 text-xs font-medium text-subtle"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {expenses.map((e) => {
                const amount  = e.amount.toNumber();
                const isVoided = e.status === 'VOIDED';
                return (
                  <tr key={e.id} className={isVoided ? 'opacity-50' : ''}>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {formatDate(e.spentOn)}
                    </td>
                    <td className="px-4 py-3 font-medium">{e.category}</td>
                    <td className="px-4 py-3 text-muted">{e.note ?? '—'}</td>
                    <td className="px-4 py-3">{e.currency}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {e.currency === 'USD' ? formatUSD(amount) : formatZiG(amount)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {e.recorder.fullName}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        label={e.status}
                        variant={e.status === 'ACTIVE' ? 'success' : 'neutral'}
                      />
                    </td>
                    {canVoid && (
                      <td className="px-4 py-3">
                        {!isVoided && (
                          <Suspense>
                            <ExpenseVoidButton expenseId={e.id} />
                          </Suspense>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

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
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#292524]">Expenses</h1>
          <p className="mt-0.5 text-sm text-[#78716c]">Track and manage school expenditure</p>
        </div>
        <LogExpenseModal />
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-[#e7e5e4] bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#78716c]">Total USD (active)</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[#292524]">{formatUSD(totalUSD)}</p>
        </div>
        <div className="rounded-xl border border-[#e7e5e4] bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#78716c]">Total ZiG (active)</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[#292524]">{formatZiG(totalZiG)}</p>
        </div>
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
        <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-12 text-center text-sm text-[#78716c]">
          No expenses recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
          <table className="w-full text-left text-sm text-[#292524]">
            <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
              <tr>
                {['Date', 'Category', 'Note', 'Currency', 'Amount', 'Recorded By', 'Status', ...(canVoid ? [''] : [])].map(
                  (h, i) => (
                    <th
                      key={i}
                      className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e7e5e4] bg-white">
              {expenses.map((e) => {
                const amount  = e.amount.toNumber();
                const isVoided = e.status === 'VOIDED';
                return (
                  <tr key={e.id} className={isVoided ? 'opacity-50' : ''}>
                    <td className="whitespace-nowrap px-4 py-3 text-[#78716c]">
                      {formatDate(e.spentOn)}
                    </td>
                    <td className="px-4 py-3 font-medium">{e.category}</td>
                    <td className="px-4 py-3 text-[#78716c]">{e.note ?? '—'}</td>
                    <td className="px-4 py-3">{e.currency}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {e.currency === 'USD' ? formatUSD(amount) : formatZiG(amount)}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#78716c]">
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

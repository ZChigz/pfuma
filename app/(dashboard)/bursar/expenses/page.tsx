import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { formatUSD, formatZiG, formatDate } from '@/lib/utils';
import { ExpenseForm } from '@/components/accounting/ExpenseForm';
import type { SessionUser } from '@/types';

export default async function BursarExpensesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'BURSAR') redirect('/');

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const expenses = await prisma.expense.findMany({
    where: {
      schoolId: user.schoolId,
      recordedBy: user.id,
      spentOn: { gte: startOfToday, lt: startOfTomorrow },
    },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#292524]">Direct expenses (pre-approved)</h1>
        <p className="mt-0.5 text-sm text-[#78716c]">Record routine, low-value expenses that don&apos;t need approval</p>
        <p className="mt-1 text-xs text-[#78716c]">
          For purchases above $50, use the Expense Request workflow under Disbursements.
        </p>
      </div>

      <div className="max-w-md rounded-xl border border-[#e7e5e4] bg-white p-4">
        <ExpenseForm />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-[#292524]">Today&apos;s expenses</h2>
        {expenses.length === 0 ? (
          <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-12 text-center text-sm text-[#78716c]">
            No expenses logged today.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
            <table className="w-full text-left text-sm text-[#292524]">
              <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
                <tr>
                  {['Date', 'Category', 'Note', 'Currency', 'Amount'].map((h) => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e7e5e4] bg-white">
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-[#78716c]">{formatDate(e.spentOn)}</td>
                    <td className="px-4 py-3 font-medium">{e.category}</td>
                    <td className="px-4 py-3 text-[#78716c]">{e.note ?? '—'}</td>
                    <td className="px-4 py-3">{e.currency}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {e.currency === 'USD' ? formatUSD(e.amount.toNumber()) : formatZiG(e.amount.toNumber())}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

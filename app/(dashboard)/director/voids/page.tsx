import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { cn, formatUSD, formatZiG, formatDate, formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { PaymentActionButton } from '@/components/accounting/PaymentActionButton';
import { ExpenseVoidButton } from '@/components/accounting/ExpenseVoidButton';
import type { SessionUser } from '@/types';

type Tab = 'payments' | 'expenses';

export default async function VoidsPage({
  searchParams,
}: {
  searchParams: { tab?: string; q?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'DIRECTOR') redirect('/');

  const tab: Tab = searchParams.tab === 'expenses' ? 'expenses' : 'payments';
  const q = searchParams.q?.trim() ?? '';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#14301f]">Void Entries</h1>
        <p className="mt-0.5 text-sm text-[#6b7a70]">Void verified payments or expenses</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[#e3e9e4]">
        {(['payments', 'expenses'] as const).map((t) => (
          <Link
            key={t}
            href={`/director/voids?tab=${t}`}
            className={cn(
              'min-h-[44px] border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors',
              tab === t
                ? 'border-[#14613f] text-[#14613f]'
                : 'border-transparent text-[#6b7a70] hover:text-[#14301f]',
            )}
          >
            {t}
          </Link>
        ))}
      </div>

      {/* Search */}
      <form method="get" className="flex gap-2">
        <input type="hidden" name="tab" value={tab} />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={tab === 'payments' ? 'Search by student or fee label…' : 'Search by category or note…'}
          className="min-h-[44px] w-full max-w-sm rounded-xl border border-[#e3e9e4] bg-white px-3 text-sm text-[#14301f] focus:outline-none focus:ring-2 focus:ring-[#14613f]/30"
        />
        <button
          type="submit"
          className="min-h-[44px] rounded-xl border border-[#e3e9e4] bg-white px-4 text-sm font-medium text-[#14301f] hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#14613f]/40"
        >
          Search
        </button>
      </form>

      {tab === 'payments' ? <PaymentsTabContent schoolId={user.schoolId} q={q} /> : <ExpensesTabContent schoolId={user.schoolId} q={q} />}
    </div>
  );
}

// ── Payments tab ─────────────────────────────────────────────────────────────

async function PaymentsTabContent({ schoolId, q }: { schoolId: string; q: string }) {
  const include = {
    student: { select: { fullName: true, grade: true } },
    voider:  { select: { fullName: true } },
  } as const;

  const searchFilter = q
    ? {
        OR: [
          { student: { fullName: { contains: q, mode: 'insensitive' as const } } },
          { feeLabel: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const [verified, voided] = await Promise.all([
    prisma.payment.findMany({
      where: { schoolId, status: 'VERIFIED', ...searchFilter },
      include,
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.payment.findMany({
      where: { schoolId, status: 'VOIDED', ...searchFilter },
      include,
      orderBy: { recordedAt: 'desc' },
    }),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-base font-semibold text-[#14301f]">Verified Payments</h2>
        {verified.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-[#6b7a70]">
            No verified payments found.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[#e3e9e4]">
            <table className="w-full text-left text-sm text-[#14301f]">
              <thead className="border-b border-[#e3e9e4] bg-[#f4f6f4]">
                <tr>
                  {['Student', 'Fee Label', 'Method', 'Reference', 'Amount', 'Date', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-xs font-semibold   text-[#6b7a70]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e3e9e4] bg-white">
                {verified.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{p.student.fullName}</p>
                      <p className="text-xs text-[#6b7a70]">{p.student.grade}</p>
                    </td>
                    <td className="px-4 py-3">{p.feeLabel}</td>
                    <td className="px-4 py-3">
                      <Badge label={p.method} variant={p.method === 'CASH' ? 'success' : 'neutral'} />
                    </td>
                    <td className="px-4 py-3 text-[#6b7a70]">{p.reference ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {p.currency === 'USD' ? formatUSD(p.amount.toNumber()) : formatZiG(p.amount.toNumber())}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-[#6b7a70]">{formatDateTime(p.recordedAt)}</td>
                    <td className="px-4 py-3">
                      <PaymentActionButton paymentId={p.id} action="void" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-[#14301f]">Voided Payments</h2>
        {voided.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-[#6b7a70]">
            No voided payments.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[#e3e9e4] opacity-60">
            <table className="w-full text-left text-sm text-[#14301f]">
              <thead className="border-b border-[#e3e9e4] bg-[#f4f6f4]">
                <tr>
                  {['Student', 'Fee Label', 'Method', 'Reference', 'Amount', 'Date', 'Voided By'].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-xs font-semibold   text-[#6b7a70]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e3e9e4] bg-white">
                {voided.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{p.student.fullName}</p>
                      <p className="text-xs text-[#6b7a70]">{p.student.grade}</p>
                    </td>
                    <td className="px-4 py-3">{p.feeLabel}</td>
                    <td className="px-4 py-3">
                      <Badge label={p.method} variant="neutral" />
                    </td>
                    <td className="px-4 py-3 text-[#6b7a70]">{p.reference ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {p.currency === 'USD' ? formatUSD(p.amount.toNumber()) : formatZiG(p.amount.toNumber())}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-[#6b7a70]">{formatDateTime(p.recordedAt)}</td>
                    <td className="px-4 py-3 text-xs text-[#6b7a70]">
                      {p.voider?.fullName ?? '—'}
                      {p.voidedAt ? ` · ${formatDateTime(p.voidedAt)}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Expenses tab ─────────────────────────────────────────────────────────────

async function ExpensesTabContent({ schoolId, q }: { schoolId: string; q: string }) {
  const include = {
    recorder: { select: { fullName: true } },
    voider:   { select: { fullName: true } },
  } as const;

  const searchFilter = q
    ? {
        OR: [
          { category: { contains: q, mode: 'insensitive' as const } },
          { note:     { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const [active, voided] = await Promise.all([
    prisma.expense.findMany({
      where: { schoolId, status: 'ACTIVE', ...searchFilter },
      include,
      orderBy: { spentOn: 'desc' },
    }),
    prisma.expense.findMany({
      where: { schoolId, status: 'VOIDED', ...searchFilter },
      include,
      orderBy: { spentOn: 'desc' },
    }),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-base font-semibold text-[#14301f]">Active Expenses</h2>
        {active.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-[#6b7a70]">
            No active expenses found.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[#e3e9e4]">
            <table className="w-full text-left text-sm text-[#14301f]">
              <thead className="border-b border-[#e3e9e4] bg-[#f4f6f4]">
                <tr>
                  {['Date', 'Category', 'Note', 'Amount', 'Recorded By', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-xs font-semibold   text-[#6b7a70]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e3e9e4] bg-white">
                {active.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-[#6b7a70]">{formatDate(e.spentOn)}</td>
                    <td className="px-4 py-3 font-medium">{e.category}</td>
                    <td className="px-4 py-3 text-[#6b7a70]">{e.note ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {e.currency === 'USD' ? formatUSD(e.amount.toNumber()) : formatZiG(e.amount.toNumber())}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#6b7a70]">{e.recorder.fullName}</td>
                    <td className="px-4 py-3">
                      <ExpenseVoidButton expenseId={e.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-[#14301f]">Voided Expenses</h2>
        {voided.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-[#6b7a70]">
            No voided expenses.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[#e3e9e4] opacity-60">
            <table className="w-full text-left text-sm text-[#14301f]">
              <thead className="border-b border-[#e3e9e4] bg-[#f4f6f4]">
                <tr>
                  {['Date', 'Category', 'Note', 'Amount', 'Recorded By', 'Voided By'].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-xs font-semibold   text-[#6b7a70]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e3e9e4] bg-white">
                {voided.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-[#6b7a70]">{formatDate(e.spentOn)}</td>
                    <td className="px-4 py-3 font-medium">{e.category}</td>
                    <td className="px-4 py-3 text-[#6b7a70]">{e.note ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {e.currency === 'USD' ? formatUSD(e.amount.toNumber()) : formatZiG(e.amount.toNumber())}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#6b7a70]">{e.recorder.fullName}</td>
                    <td className="px-4 py-3 text-xs text-[#6b7a70]">{e.voider?.fullName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

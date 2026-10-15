import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { cn, formatUSD, formatZiG, formatDate, formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { PaymentActionButton } from '@/components/accounting/PaymentActionButton';
import { ProofLink } from '@/components/accounting/ProofLink';
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
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Void Entries</h1>
        <p className="mt-1 text-sm text-muted">Void verified payments or expenses</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-line">
        {(['payments', 'expenses'] as const).map((t) => (
          <Link
            key={t}
            href={`/director/voids?tab=${t}`}
            className={cn(
              'min-h-[44px] border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors',
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-ink',
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
          className="min-h-[44px] w-full max-w-sm rounded-xl border border-line bg-white px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          type="submit"
          className="min-h-[44px] rounded-xl border border-line bg-white px-4 text-sm font-medium text-ink hover:bg-rowhover focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          Search
        </button>
      </form>

      {tab === 'payments' ? <PaymentsTabContent schoolId={user.schoolId} actorId={user.id} q={q} /> : <ExpensesTabContent schoolId={user.schoolId} actorId={user.id} q={q} />}
    </div>
  );
}

// ── Payments tab ─────────────────────────────────────────────────────────────

async function PaymentsTabContent({ schoolId, actorId, q }: { schoolId: string; actorId: string; q: string }) {
  const db = getScopedDb(schoolId, actorId);
  const include = {
    student: { select: { fullName: true, currentClass: { select: { name: true } } } },
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
    db.payment.findMany({
      where: { schoolId, status: 'VERIFIED', ...searchFilter },
      include,
      orderBy: { recordedAt: 'desc' },
    }),
    db.payment.findMany({
      where: { schoolId, status: 'VOIDED', ...searchFilter },
      include,
      orderBy: { recordedAt: 'desc' },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 text-base font-semibold text-ink">Verified Payments</h2>
        {verified.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
            No verified payments found.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full text-left text-sm text-ink">
              <thead className="border-b border-line bg-white">
                <tr>
                  {['Student', 'Fee Label', 'Method', 'Reference', 'Amount', 'Date', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3.5 text-xs font-medium text-subtle">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {verified.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{p.student.fullName}</p>
                      <p className="text-xs text-muted">{p.student.currentClass?.name ?? ''}</p>
                    </td>
                    <td className="px-4 py-3">{p.feeLabel}</td>
                    <td className="px-4 py-3">
                      <Badge label={p.method} variant={p.method === 'CASH' ? 'success' : 'neutral'} />
                    </td>
                    <td className="px-4 py-3 text-muted">{p.reference ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {p.currency === 'USD' ? formatUSD(p.amount.toNumber()) : formatZiG(p.amount.toNumber())}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{formatDateTime(p.recordedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <PaymentActionButton paymentId={p.id} action="void" />
                        {(p.popKey || p.popUrl) && <ProofLink paymentId={p.id} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-ink">Voided Payments</h2>
        {voided.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
            No voided payments.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white opacity-60">
            <table className="w-full text-left text-sm text-ink">
              <thead className="border-b border-line bg-white">
                <tr>
                  {['Student', 'Fee Label', 'Method', 'Reference', 'Amount', 'Date', 'Voided By'].map((h, i) => (
                    <th key={i} className="px-4 py-3.5 text-xs font-medium text-subtle">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {voided.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{p.student.fullName}</p>
                      <p className="text-xs text-muted">{p.student.currentClass?.name ?? ''}</p>
                    </td>
                    <td className="px-4 py-3">{p.feeLabel}</td>
                    <td className="px-4 py-3">
                      <Badge label={p.method} variant="neutral" />
                    </td>
                    <td className="px-4 py-3 text-muted">{p.reference ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {p.currency === 'USD' ? formatUSD(p.amount.toNumber()) : formatZiG(p.amount.toNumber())}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{formatDateTime(p.recordedAt)}</td>
                    <td className="px-4 py-3 text-xs text-muted">
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

async function ExpensesTabContent({ schoolId, actorId, q }: { schoolId: string; actorId: string; q: string }) {
  const db = getScopedDb(schoolId, actorId);
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
    db.expense.findMany({
      where: { schoolId, status: 'ACTIVE', ...searchFilter },
      include,
      orderBy: { spentOn: 'desc' },
    }),
    db.expense.findMany({
      where: { schoolId, status: 'VOIDED', ...searchFilter },
      include,
      orderBy: { spentOn: 'desc' },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 text-base font-semibold text-ink">Active Expenses</h2>
        {active.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
            No active expenses found.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full text-left text-sm text-ink">
              <thead className="border-b border-line bg-white">
                <tr>
                  {['Date', 'Category', 'Note', 'Amount', 'Recorded By', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3.5 text-xs font-medium text-subtle">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {active.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDate(e.spentOn)}</td>
                    <td className="px-4 py-3 font-medium">{e.category}</td>
                    <td className="px-4 py-3 text-muted">{e.note ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {e.currency === 'USD' ? formatUSD(e.amount.toNumber()) : formatZiG(e.amount.toNumber())}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{e.recorder.fullName}</td>
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
        <h2 className="mb-3 text-base font-semibold text-ink">Voided Expenses</h2>
        {voided.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
            No voided expenses.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white opacity-60">
            <table className="w-full text-left text-sm text-ink">
              <thead className="border-b border-line bg-white">
                <tr>
                  {['Date', 'Category', 'Note', 'Amount', 'Recorded By', 'Voided By'].map((h, i) => (
                    <th key={i} className="px-4 py-3.5 text-xs font-medium text-subtle">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {voided.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDate(e.spentOn)}</td>
                    <td className="px-4 py-3 font-medium">{e.category}</td>
                    <td className="px-4 py-3 text-muted">{e.note ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {e.currency === 'USD' ? formatUSD(e.amount.toNumber()) : formatZiG(e.amount.toNumber())}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{e.recorder.fullName}</td>
                    <td className="px-4 py-3 text-xs text-muted">{e.voider?.fullName ?? '—'}</td>
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

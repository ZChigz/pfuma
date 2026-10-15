import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import { Permission } from '@/lib/permissions';
import { formatDateTime } from '@/lib/utils';
import { UpdateRateForm } from '@/components/accounting/UpdateRateForm';
import type { SessionUser } from '@/types';

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  if (!Permission.manageStudents.includes(user.role)) redirect('/accounting');

  const [current, history] = await Promise.all([
    db.exchangeRate.findFirst({
      where:   { schoolId: user.schoolId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { fullName: true } } },
    }),
    db.exchangeRate.findMany({
      where:   { schoolId: user.schoolId },
      orderBy: { createdAt: 'desc' },
      take:    10,
      include: { user: { select: { fullName: true } } },
    }),
  ]);

  const currentRate = current ? current.usdToZig.toNumber() : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Settings</h1>
        <p className="mt-1 text-sm text-muted">Manage school financial settings</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Current Rate Card ── */}
        <div className="rounded-2xl bg-white p-5">
          <h2 className="mb-3 text-base font-semibold text-ink">Current Exchange Rate</h2>
          <p className={`text-4xl font-extrabold ${currentRate != null ? 'text-primary' : 'text-subtle'}`}>
            {currentRate != null ? `1 USD = ZiG ${currentRate.toFixed(2)}` : 'Not set'}
          </p>
          {current ? (
            <div className="mt-3 space-y-1 text-sm text-muted">
              <p>Set by <span className="font-medium text-ink">{current.user.fullName}</span>, {formatDateTime(current.createdAt)}</p>
              {current.note && (
                <p className="italic">&ldquo;{current.note}&rdquo;</p>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm italic text-muted">
              No exchange rate has been set yet.
            </p>
          )}
        </div>

        {/* ── Update Rate Form ── */}
        <div className="rounded-2xl bg-white p-5">
          <h2 className="mb-3 text-base font-semibold text-ink">Update Rate</h2>
          <UpdateRateForm currentRate={currentRate} />
        </div>
      </div>

      {/* ── Rate History ── */}
      {history.length > 0 && (
        <div>
          <h2 className="mb-3 text-base font-semibold text-ink">Rate History</h2>
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full text-left text-sm text-ink">
              <thead className="border-b border-line bg-white">
                <tr>
                  {['Date', 'Rate (ZiG / USD)', 'Set By', 'Note'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3.5 text-xs font-medium text-subtle"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {history.map((r, i) => (
                  <tr key={r.id} className={i === 0 ? 'bg-success-bg' : ''}>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-primary">
                      {r.usdToZig.toNumber().toFixed(2)}
                    </td>
                    <td className="px-4 py-3">{r.user.fullName}</td>
                    <td className="px-4 py-3 text-muted">{r.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

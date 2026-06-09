import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Permission } from '@/lib/permissions';
import { formatDateTime } from '@/lib/utils';
import { UpdateRateForm } from '@/components/accounting/UpdateRateForm';
import type { SessionUser } from '@/types';

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;

  if (!Permission.manageStudents.includes(user.role)) redirect('/accounting');

  const [current, history] = await Promise.all([
    prisma.exchangeRate.findFirst({
      where:   { schoolId: user.schoolId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { fullName: true } } },
    }),
    prisma.exchangeRate.findMany({
      where:   { schoolId: user.schoolId },
      orderBy: { createdAt: 'desc' },
      take:    10,
      include: { user: { select: { fullName: true } } },
    }),
  ]);

  const currentRate = current ? current.usdToZig.toNumber() : null;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-[#292524]">Settings</h1>
        <p className="mt-0.5 text-sm text-[#78716c]">Manage school financial settings</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Current Rate Card ── */}
        <div className="rounded-xl border border-[#e7e5e4] bg-white p-6">
          <h2 className="mb-4 text-base font-semibold text-[#292524]">Current Exchange Rate</h2>
          <p className={`text-4xl font-extrabold ${currentRate != null ? 'text-[#065f46]' : 'text-[#a8a29e]'}`}>
            {currentRate != null ? `1 USD = ZiG ${currentRate.toFixed(2)}` : 'Not set'}
          </p>
          {current ? (
            <div className="mt-3 space-y-1 text-sm text-[#78716c]">
              <p>Set by <span className="font-medium text-[#292524]">{current.user.fullName}</span>, {formatDateTime(current.createdAt)}</p>
              {current.note && (
                <p className="italic">"{current.note}"</p>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm italic text-[#78716c]">
              No exchange rate has been set yet.
            </p>
          )}
        </div>

        {/* ── Update Rate Form ── */}
        <div className="rounded-xl border border-[#e7e5e4] bg-white p-6">
          <h2 className="mb-4 text-base font-semibold text-[#292524]">Update Rate</h2>
          <UpdateRateForm currentRate={currentRate} />
        </div>
      </div>

      {/* ── Rate History ── */}
      {history.length > 0 && (
        <div>
          <h2 className="mb-3 text-base font-semibold text-[#292524]">Rate History</h2>
          <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
            <table className="w-full text-left text-sm text-[#292524]">
              <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
                <tr>
                  {['Date', 'Rate (ZiG / USD)', 'Set By', 'Note'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e7e5e4] bg-white">
                {history.map((r, i) => (
                  <tr key={r.id} className={i === 0 ? 'bg-[#f0fdf4]' : ''}>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-[#78716c]">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-[#065f46]">
                      {r.usdToZig.toNumber().toFixed(2)}
                    </td>
                    <td className="px-4 py-3">{r.user.fullName}</td>
                    <td className="px-4 py-3 text-[#78716c]">{r.note ?? '—'}</td>
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

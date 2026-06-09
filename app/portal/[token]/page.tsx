// Public portal — NO auth(), NO redirect('/login'). Accessible without a session.
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function fmt(n: number, currency: string) {
  return currency === 'USD'
    ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `ZiG ${Math.round(n).toLocaleString('en-US')}`;
}

function fmtDate(d: Date | string) {
  const date = new Date(d);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(date.getDate()).padStart(2,'0')} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

export default async function PortalPage({ params }: { params: { token: string } }) {
  const student = await prisma.student.findUnique({
    where: { portalToken: params.token },
    include: {
      school: {
        select: {
          name: true,
          gradeBoundaries: {
            select: { minPercent: true, maxPercent: true, letterGrade: true },
          },
        },
      },
      charges: { select: { currency: true, amount: true } },
      payments: {
        where:   { status: 'VERIFIED' },
        select:  { recordedAt: true, method: true, amount: true, currency: true, paidInZig: true, zigAmountPaid: true, exchangeRateUsed: true },
        orderBy: { recordedAt: 'desc' },
      },
      marks: {
        include: { subject: { select: { name: true, maxMark: true } } },
        orderBy: [{ term: 'asc' }, { subject: { name: 'asc' } }],
      },
      termResults: {
        where:   { published: true },
        orderBy: { term: 'asc' },
      },
    },
  });

  // ── Not found ──────────────────────────────────────────────────────────────
  if (!student) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f5f4] p-6">
        <div className="w-full max-w-md rounded-2xl border border-[#e7e5e4] bg-white p-10 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
            <svg className="h-7 w-7 text-[#b91c1c]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M15 9l-6 6M9 9l6 6" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-[#292524]">Link not found or expired</h1>
          <p className="mt-2 text-sm text-[#78716c]">
            This portal link is invalid. Please contact the school office for a new link.
          </p>
        </div>
      </div>
    );
  }

  // ── Compute fee balances ───────────────────────────────────────────────────
  const chargesUSD = student.charges.filter(c => c.currency === 'USD').reduce((n, c) => n + c.amount.toNumber(), 0);
  const chargesZiG = student.charges.filter(c => c.currency === 'ZIG').reduce((n, c) => n + c.amount.toNumber(), 0);
  const paidUSD    = student.payments.filter(p => p.currency === 'USD').reduce((n, p) => n + p.amount.toNumber(), 0);
  const paidZiG    = student.payments.filter(p => p.currency === 'ZIG').reduce((n, p) => n + p.amount.toNumber(), 0);
  const balUSD     = chargesUSD - paidUSD;
  const balZiG     = chargesZiG - paidZiG;

  const recentPayments = student.payments.slice(0, 10);

  // ── Group marks by term ────────────────────────────────────────────────────
  const marksByTerm = new Map<string, typeof student.marks>();
  for (const m of student.marks) {
    const arr = marksByTerm.get(m.term) ?? [];
    arr.push(m);
    marksByTerm.set(m.term, arr);
  }

  // ── Letter grade helper ────────────────────────────────────────────────────
  const boundaries = student.school.gradeBoundaries;
  function getGrade(pct: number) {
    return boundaries.find(b => pct >= b.minPercent.toNumber() && pct <= b.maxPercent.toNumber())?.letterGrade ?? '—';
  }

  const publishedTerms = student.termResults;

  return (
    <div className="min-h-screen bg-[#f5f5f4]">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-[#065f46] px-4 py-6 text-white shadow-sm">
        <div className="mx-auto max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-200">Student Portal</p>
          <h1 className="mt-1 text-2xl font-bold">{student.school.name}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        {/* Student summary */}
        <div className="rounded-xl border border-[#e7e5e4] bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#78716c]">Student</p>
          <p className="mt-1 text-xl font-bold text-[#292524]">{student.fullName}</p>
          <p className="text-sm text-[#78716c]">{student.grade}</p>
        </div>

        {/* ── Section 1: Fee Balance ──────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-base font-bold text-[#292524]">Fee Balance</h2>

          <div className="rounded-xl border border-[#e7e5e4] bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#f5f5f4] border-b border-[#e7e5e4]">
                <tr>
                  {['Currency', 'Billed', 'Paid', 'Balance'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e7e5e4]">
                <tr>
                  <td className="px-4 py-3 font-semibold">USD</td>
                  <td className="px-4 py-3 tabular-nums">{fmt(chargesUSD, 'USD')}</td>
                  <td className="px-4 py-3 tabular-nums">{fmt(paidUSD, 'USD')}</td>
                  <td className={`px-4 py-3 tabular-nums font-bold ${balUSD > 0 ? 'text-[#b91c1c]' : 'text-[#15803d]'}`}>
                    {fmt(balUSD, 'USD')}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold">ZiG</td>
                  <td className="px-4 py-3 tabular-nums">{fmt(chargesZiG, 'ZIG')}</td>
                  <td className="px-4 py-3 tabular-nums">{fmt(paidZiG, 'ZIG')}</td>
                  <td className={`px-4 py-3 tabular-nums font-bold ${balZiG > 0 ? 'text-[#b91c1c]' : 'text-[#15803d]'}`}>
                    {fmt(balZiG, 'ZIG')}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {recentPayments.length > 0 && (
            <div className="mt-4 rounded-xl border border-[#e7e5e4] bg-white shadow-sm overflow-hidden">
              <p className="border-b border-[#e7e5e4] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                Recent Payments
              </p>
              <table className="w-full text-sm">
                <thead className="bg-[#f5f5f4] border-b border-[#e7e5e4]">
                  <tr>
                    {['Date', 'Method', 'Amount', 'Currency'].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-medium text-[#78716c]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e7e5e4]">
                  {recentPayments.map((p, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 text-xs text-[#78716c]">{fmtDate(p.recordedAt)}</td>
                      <td className="px-4 py-2 text-xs">{p.method}</td>
                      <td className="px-4 py-2 tabular-nums text-xs">
                        <span>{fmt(p.amount.toNumber(), p.currency)}</span>
                        {p.paidInZig && p.zigAmountPaid && (
                          <p className="mt-0.5 text-[10px] text-[#78716c]">
                            ZiG {Math.round(p.zigAmountPaid.toNumber()).toLocaleString('en-US')} @ {p.exchangeRateUsed?.toNumber().toFixed(2)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-[#78716c]">{p.currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Section 2: Academic Results ────────────────────────────────── */}
        {publishedTerms.length > 0 && (
          <section>
            <h2 className="mb-3 text-base font-bold text-[#292524]">Academic Results</h2>
            <div className="flex flex-col gap-4">
              {publishedTerms.map((tr) => {
                const termMarks = marksByTerm.get(tr.term) ?? [];
                const pct = tr.percentage.toNumber();
                return (
                  <div key={tr.id} className="rounded-xl border border-[#e7e5e4] bg-white shadow-sm overflow-hidden">
                    {/* Term header */}
                    <div className="border-b border-[#e7e5e4] bg-[#065f46] px-4 py-3 text-white">
                      <p className="text-sm font-bold">{tr.term}</p>
                    </div>

                    {/* Summary row */}
                    <div className="grid grid-cols-4 divide-x divide-[#e7e5e4] border-b border-[#e7e5e4]">
                      {[
                        { label: 'Total', value: tr.totalMarks.toNumber().toFixed(1) },
                        { label: 'Percentage', value: `${pct.toFixed(1)}%` },
                        { label: 'Grade', value: getGrade(pct) },
                        { label: 'Position', value: tr.classPosition != null ? `${tr.classPosition}` : '—' },
                      ].map(({ label, value }) => (
                        <div key={label} className="p-3 text-center">
                          <p className="text-xs text-[#78716c]">{label}</p>
                          <p className="mt-0.5 text-sm font-bold text-[#292524]">{value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Marks breakdown */}
                    {termMarks.length > 0 && (
                      <table className="w-full text-sm">
                        <thead className="bg-[#f5f5f4] border-b border-[#e7e5e4]">
                          <tr>
                            {['Subject', 'Mark', 'Max', 'Grade'].map((h) => (
                              <th key={h} className="px-4 py-2 text-left text-xs font-medium text-[#78716c]">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e7e5e4]">
                          {termMarks.map((m, i) => (
                            <tr key={i} className={i % 2 === 1 ? 'bg-[#f5f5f4]' : ''}>
                              <td className="px-4 py-2">{m.subject.name}</td>
                              <td className="px-4 py-2 tabular-nums">{m.rawMark.toNumber().toFixed(1)}</td>
                              <td className="px-4 py-2 tabular-nums text-[#78716c]">{m.subject.maxMark}</td>
                              <td className="px-4 py-2 font-semibold">{m.letterGrade ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {publishedTerms.length === 0 && (
          <section>
            <h2 className="mb-3 text-base font-bold text-[#292524]">Academic Results</h2>
            <div className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-8 text-center text-sm text-[#78716c] shadow-sm">
              No published results yet.
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-8 border-t border-[#e7e5e4] px-4 py-5 text-center text-xs text-[#78716c]">
        This is a read-only view. Contact the school office for any changes or queries.
      </footer>
    </div>
  );
}

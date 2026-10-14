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
        where:   { status: 'PUBLISHED' },
        include: { subject: { select: { name: true, maxMark: true } } },
        orderBy: [{ term: { startDate: 'asc' } }, { subject: { name: 'asc' } }],
      },
      termResults: {
        where:   { published: true },
        include: { term: { select: { name: true } } },
        orderBy: { term: { startDate: 'asc' } },
      },
      currentClass: { select: { name: true } },
      enrollments: { select: { termId: true, classId: true } },
    },
  });

  // ── Not found ──────────────────────────────────────────────────────────────
  if (!student) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger-bg">
            <svg className="h-7 w-7 text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M15 9l-6 6M9 9l6 6" />
            </svg>
          </div>
          <h1 className="text-base font-semibold text-ink">Link not found or expired</h1>
          <p className="mt-1 text-sm text-muted">
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
    const arr = marksByTerm.get(m.termId) ?? [];
    arr.push(m);
    marksByTerm.set(m.termId, arr);
  }

  // ── Letter grade helper ────────────────────────────────────────────────────
  const boundaries = student.school.gradeBoundaries;
  function getGrade(pct: number) {
    return boundaries.find(b => pct >= b.minPercent.toNumber() && pct <= b.maxPercent.toNumber())?.letterGrade ?? '—';
  }

  const publishedTerms = student.termResults;

  // ── Class size per term (for "Position N out of M") ───────────────────────
  // Classmates are the students enrolled in the same class for that term.
  const classSizeByTerm = new Map<string, number>();
  const classByTerm = new Map(student.enrollments.map((e) => [e.termId, e.classId]));
  for (const tr of publishedTerms) {
    const classId = classByTerm.get(tr.termId);
    if (!classId) continue;
    classSizeByTerm.set(tr.termId, await prisma.termResult.count({
      where: {
        schoolId:  student.schoolId,
        published: true,
        termId:    tr.termId,
        student:   { enrollments: { some: { termId: tr.termId, classId } } },
      },
    }));
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="term-card px-4 py-8 text-white">
        <div className="mx-auto max-w-2xl">
          <p className="text-xs font-medium text-emerald-200">Student Portal</p>
          <h1 className="mt-1 text-2xl font-bold">{student.school.name}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        {/* Student summary */}
        <div className="rounded-2xl bg-white p-5">
          <p className="text-xs font-medium text-muted">Student</p>
          <p className="mt-1 text-xl font-bold text-ink">{student.fullName}</p>
          <p className="text-sm text-muted">{student.currentClass?.name ?? ''}</p>
        </div>

        {/* ── Section 1: Fee Balance ──────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">Fee Balance</h2>

          <div className="rounded-2xl bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-white">
                <tr>
                  {['Currency', 'Billed', 'Paid', 'Balance'].map((h) => (
                    <th key={h} className="px-4 py-3.5 text-left text-xs font-medium text-subtle">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr>
                  <td className="px-4 py-3 font-semibold">USD</td>
                  <td className="px-4 py-3 tabular-nums">{fmt(chargesUSD, 'USD')}</td>
                  <td className="px-4 py-3 tabular-nums">{fmt(paidUSD, 'USD')}</td>
                  <td className={`px-4 py-3 tabular-nums font-bold ${balUSD > 0 ? 'text-danger' : 'text-success'}`}>
                    {fmt(balUSD, 'USD')}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold">ZiG</td>
                  <td className="px-4 py-3 tabular-nums">{fmt(chargesZiG, 'ZIG')}</td>
                  <td className="px-4 py-3 tabular-nums">{fmt(paidZiG, 'ZIG')}</td>
                  <td className={`px-4 py-3 tabular-nums font-bold ${balZiG > 0 ? 'text-danger' : 'text-success'}`}>
                    {fmt(balZiG, 'ZIG')}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {recentPayments.length > 0 && (
            <div className="mt-4 rounded-2xl bg-white overflow-hidden">
              <p className="border-b border-line px-4 py-3 text-xs font-medium text-muted">
                Recent Payments
              </p>
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-white">
                  <tr>
                    {['Date', 'Method', 'Amount', 'Currency'].map((h) => (
                      <th key={h} className="px-4 py-3.5 text-left text-xs font-medium text-subtle">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {recentPayments.map((p, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 text-xs text-muted">{fmtDate(p.recordedAt)}</td>
                      <td className="px-4 py-2 text-xs">{p.method}</td>
                      <td className="px-4 py-2 tabular-nums text-xs">
                        <span>{fmt(p.amount.toNumber(), p.currency)}</span>
                        {p.paidInZig && p.zigAmountPaid && (
                          <p className="mt-0.5 text-[10px] text-muted">
                            ZiG {Math.round(p.zigAmountPaid.toNumber()).toLocaleString('en-US')} @ {p.exchangeRateUsed?.toNumber().toFixed(2)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted">{p.currency}</td>
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
            <h2 className="mb-3 text-base font-semibold text-ink">Academic Results</h2>
            <div className="flex flex-col gap-4">
              {publishedTerms.map((tr) => {
                const termMarks = marksByTerm.get(tr.termId) ?? [];
                const pct = tr.percentage.toNumber();
                const classSize = classSizeByTerm.get(tr.termId);
                return (
                  <div key={tr.id} className="rounded-2xl bg-white overflow-hidden">
                    {/* Term header */}
                    <div className="border-b border-line bg-primary px-4 py-3 text-white">
                      <p className="text-sm font-bold">{tr.term.name}</p>
                      {tr.classPosition != null && classSize != null && (
                        <p className="mt-0.5 text-xs text-emerald-100">
                          Position {tr.classPosition} out of {classSize} students
                        </p>
                      )}
                    </div>

                    {/* Summary row */}
                    <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
                      {[
                        { label: 'Total', value: tr.totalMarks.toNumber().toFixed(1) },
                        { label: 'Percentage', value: `${pct.toFixed(1)}%` },
                        { label: 'Grade', value: getGrade(pct) },
                      ].map(({ label, value }) => (
                        <div key={label} className="p-3 text-center">
                          <p className="text-xs text-muted">{label}</p>
                          <p className="mt-0.5 text-sm font-bold text-ink">{value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Marks breakdown */}
                    {termMarks.length > 0 && (
                      <table className="w-full text-sm">
                        <thead className="border-b border-line bg-white">
                          <tr>
                            {['Subject', 'Mark', 'Out of', '%', 'Grade'].map((h) => (
                              <th key={h} className="px-4 py-3.5 text-left text-xs font-medium text-subtle">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {termMarks.map((m, i) => (
                            <tr key={i} className={i % 2 === 1 ? 'bg-canvas' : ''}>
                              <td className="px-4 py-2">{m.subject.name}</td>
                              <td className="px-4 py-2 tabular-nums">{m.rawMark.toNumber().toFixed(1)}</td>
                              <td className="px-4 py-2 tabular-nums text-muted">{m.subject.maxMark}</td>
                              <td className="px-4 py-2 tabular-nums text-muted">{m.percentage != null ? `${m.percentage.toNumber().toFixed(1)}%` : '—'}</td>
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
            <h2 className="mb-3 text-base font-semibold text-ink">Academic Results</h2>
            <div className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
              No published results yet.
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-8 border-t border-line px-4 py-5 text-center text-xs text-muted">
        This is a read-only view. Contact the school office for any changes or queries.
      </footer>
    </div>
  );
}

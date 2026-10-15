import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Permission } from '@/lib/permissions';
import { formatDate } from '@/lib/utils';
import { listTerms } from '@/lib/academic/terms';
import {
  StudentDetailClient,
  type StatementItem,
} from '@/components/accounting/StudentDetailClient';
import type { SessionUser } from '@/types';

export default async function StudentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  const [student, terms] = await Promise.all([
    db.student.findUnique({
      where: { id: params.id, schoolId: user.schoolId },
      include: {
        charges: { orderBy: { issuedAt: 'desc' }, include: { term: { select: { name: true } } } },
        payments: { orderBy: { recordedAt: 'desc' } },
        currentClass: { select: { name: true, level: { select: { name: true } } } },
        guardians: {
          include: { guardian: { select: { fullName: true, phone: true } } },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
        enrollments: {
          include: { class: { select: { name: true } }, term: { select: { name: true, startDate: true } } },
          orderBy: { term: { startDate: 'desc' } },
        },
        portalViews: { orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, ip: true, createdAt: true } },
      },
    }),
    listTerms(user.schoolId, db),
  ]);
  if (!student) notFound();
  const primary = student.guardians.find((g) => g.isPrimary) ?? student.guardians[0];

  // Compute balances: charges - verified payments per currency
  const cUSD = student.charges.filter(c => c.currency === 'USD').reduce((n, c) => n + c.amount.toNumber(), 0);
  const cZiG = student.charges.filter(c => c.currency === 'ZIG').reduce((n, c) => n + c.amount.toNumber(), 0);
  const pUSD = student.payments.filter(p => p.currency === 'USD' && p.status === 'VERIFIED').reduce((n, p) => n + p.amount.toNumber(), 0);
  const pZiG = student.payments.filter(p => p.currency === 'ZIG' && p.status === 'VERIFIED').reduce((n, p) => n + p.amount.toNumber(), 0);

  // Merge charges + payments into a single timeline, sorted newest first.
  // Convert Decimal → number and Date → ISO string before crossing the RSC boundary.
  const statement: StatementItem[] = [
    ...student.charges.map(c => ({
      id:       c.id,
      date:     c.issuedAt.toISOString(),
      type:     'Charge' as const,
      label:    `${c.label} (${c.term.name})`,
      currency: c.currency as 'USD' | 'ZIG',
      amount:   c.amount.toNumber(),
    })),
    ...student.payments.map(p => ({
      id:              p.id,
      date:            p.recordedAt.toISOString(),
      type:            'Payment' as const,
      label:           p.feeLabel,
      currency:        p.currency as 'USD' | 'ZIG',
      amount:          p.amount.toNumber(),
      status:          p.status as 'PENDING' | 'VERIFIED' | 'VOIDED',
      method:          p.method,
      paidInZig:        p.paidInZig,
      zigAmountPaid:    p.zigAmountPaid?.toNumber()    ?? null,
      exchangeRateUsed: p.exchangeRateUsed?.toNumber() ?? null,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const portal = {
    hasLink:   !!student.portalTokenHash,
    createdAt: student.portalTokenCreatedAt?.toISOString() ?? null,
    expiresAt: student.portalTokenExpiresAt?.toISOString() ?? null,
    hasPin:    !!student.portalPinHash,
    views:     student.portalViews.map((v) => ({ id: v.id, ip: v.ip, createdAt: v.createdAt.toISOString() })),
  };
  const canApplyCharge = Permission.applyCharge.includes(user.role);

  return (
    <div>
      {/* Back navigation */}
      <Link
        href="/accounting/students"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
            clipRule="evenodd"
          />
        </svg>
        Back to Students
      </Link>

      {/* Student heading */}
      <div className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">{student.fullName}</h1>
        <p className="mt-1 text-sm text-muted">{student.admissionNumber} · {student.currentClass?.name ?? 'Not in a class'} · {student.status.charAt(0) + student.status.slice(1).toLowerCase()}</p>
      </div>

      {/* Info card */}
      <div className="mb-6 rounded-2xl bg-white p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <InfoItem label="Level"              value={student.currentClass?.level.name ?? '—'} />
          <InfoItem label="Primary guardian"   value={primary?.guardian.fullName ?? '—'} />
          <InfoItem label="Phone"              value={primary?.guardian.phone ?? '—'} />
          <InfoItem label="Admitted"           value={formatDate(student.admissionDate)} />
        </div>
        {student.guardians.length > 1 && (
          <p className="mt-4 text-xs text-muted">
            Other guardians: {student.guardians.filter((g) => g !== primary).map((g) => `${g.guardian.fullName} (${g.guardian.phone})`).join(', ')}
          </p>
        )}
      </div>

      {/* Class history (one row per term, from Enrollment) */}
      {student.enrollments.length > 0 && (
        <div className="mb-6 rounded-2xl bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Class history</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {student.enrollments.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2">
                <span className="text-ink">{e.term.name} — {e.class.name}</span>
                <span className="text-xs text-muted">{e.status.replace('_', ' ').toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <StudentDetailClient
        studentId={student.id}
        terms={terms.map((t) => ({ id: t.id, name: t.name, status: t.status }))}
        portal={portal}
        balanceUSD={cUSD - pUSD}
        balanceZiG={cZiG - pZiG}
        statement={statement}
        canApplyCharge={canApplyCharge}
      />
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium   text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-ink">{value}</p>
    </div>
  );
}

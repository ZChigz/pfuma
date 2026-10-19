import { CrumbLabel } from '@/components/layout/Breadcrumbs';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { notFound, redirect } from 'next/navigation';
import { Permission } from '@/lib/permissions';
import { formatDate } from '@/lib/utils';
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

  const student = await prisma.student.findUnique({
    where: { id: params.id, schoolId: user.schoolId },
    include: {
      charges: { orderBy: { issuedAt: 'desc' } },
      payments: { orderBy: { recordedAt: 'desc' } },
    },
  });
  if (!student) notFound();

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
      label:    c.label,
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

  const portalUrl    = `${process.env.NEXTAUTH_URL}/portal/${student.portalToken}`;
  const canApplyCharge = Permission.applyCharge.includes(user.role);

  return (
    <div>
      <CrumbLabel label={student.fullName} />

      {/* Student heading */}
      <div className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">{student.fullName}</h1>
        <p className="mt-1 text-sm text-muted">{student.grade}</p>
      </div>

      {/* Info card */}
      <div className="mb-6 rounded-2xl bg-white p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <InfoItem label="Grade"              value={student.grade}       />
          <InfoItem label="Parent / Guardian"  value={student.parentName}  />
          <InfoItem label="Phone"              value={student.parentPhone} />
          <InfoItem label="Enrolled"           value={formatDate(student.createdAt)} />
        </div>
      </div>

      <StudentDetailClient
        studentId={student.id}
        portalUrl={portalUrl}
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

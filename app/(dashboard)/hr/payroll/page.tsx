import Link from 'next/link';
import { getHrAccess as getAccess } from '@/lib/hr/access';
import { listRuns } from '@/lib/payroll/run';
import { getPayrollSettings } from '@/lib/payroll/settings-service';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Money } from '@/components/finance/format';
import { Notice, Section, Td, Th } from '@/components/finance/shared';
import { HrNav } from '@/components/hr/HrNav';

export const metadata = { title: 'Payroll · Pfuma' };

type T = { total: { USD: { grossCents: number; netCents: number; people: number }; ZIG: { grossCents: number; netCents: number; people: number } } } | null;
const VARIANT = { DRAFT: 'neutral', SUBMITTED: 'warning', APPROVED: 'info', PAID: 'success', RETURNED: 'danger' } as const;

export default async function PayrollPage() {
  const { user, can } = await getAccess();
  if (!can('hr.payroll.view') && !can('hr.payroll.prepare') && !can('hr.payroll.approve')) return <AccessDenied />;
  const [runs, settings] = await Promise.all([listRuns(user), getPayrollSettings(user).catch(() => null)]);
  const unconfirmed = settings ? settings.tables.USD.some((t) => !t.confirmed) || settings.tables.ZIG.some((t) => !t.confirmed) || settings.rates.some((r) => !r.confirmed) : false;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Payroll" description="School-paid staff only. HR prepares and submits, the Owner approves, Finance pays. Three different people before any money leaves."
        actions={<div className="flex flex-wrap gap-2"><Link className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary" href="/hr/payroll/settings">Tax tables and rates</Link>
          {can('hr.payroll.prepare') && <FormAction label="Start a payroll run" variant="primary" size="md" url="/api/hr/payroll/runs" done="Run started" fields={[{ name: 'month', label: 'Month (YYYY-MM)', required: true, placeholder: '2026-10', maxLength: 7 }]} />}</div>} />
      <HrNav can={can} current="/hr/payroll" />
      {unconfirmed && <Notice tone="warn">The tax tables or statutory rates have not been confirmed by the school&apos;s accountant yet. A run cannot be made until they are (Tax tables and rates).</Notice>}
      <Section title="Runs">
        <div className="overflow-x-auto"><table className="w-full min-w-[36rem]"><thead><tr><Th>Month</Th><Th>Status</Th><Th className="text-right">People</Th><Th className="text-right">Net US$</Th><Th className="text-right">Net ZiG</Th></tr></thead><tbody>
          {runs.map((r) => { const t = r.totals as T; return (
            <tr key={r.id} className="border-t border-line"><Td><Link className="font-semibold text-primary hover:underline" href={`/hr/payroll/${r.id}`}>{r.month}</Link></Td><Td><Badge variant={VARIANT[r.status]} label={r.status.charAt(0) + r.status.slice(1).toLowerCase()} /></Td>
              <Td className="text-right">{t ? Math.max(t.total.USD.people, t.total.ZIG.people) : 0}</Td><Td className="text-right">{t ? <Money cents={t.total.USD.netCents} currency="USD" /> : '—'}</Td><Td className="text-right">{t ? <Money cents={t.total.ZIG.netCents} currency="ZIG" /> : '—'}</Td></tr>);
          })}
          {runs.length === 0 && <tr><Td className="text-muted">No payroll runs yet.</Td></tr>}
        </tbody></table></div>
      </Section>
    </div>
  );
}

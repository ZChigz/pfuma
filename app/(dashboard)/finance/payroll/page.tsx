import { getAccess } from '@/lib/access';
import { listPayroll, statutoryDue } from '@/lib/finance/payroll';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { FormAction } from '@/components/finance/FormAction';
import { Notice, RowAction, Section, StatusBadge, Td, Th } from '@/components/finance/shared';
import { Money, MoneyLine, methodLabel } from '@/components/finance/format';

export const metadata = { title: 'Payroll · Pfuma' };

export default async function PayrollPage() {
  const { user, can } = await getAccess();
  if (!can('finance.payroll.pay')) return <AccessDenied />;
  const [runs, due] = await Promise.all([listPayroll(user), statutoryDue(user)]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Payroll" description="HR prepares the payroll and the Owner approves it; Finance only pays it, and never the person who prepared it. Paying a line records a Salaries expense." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Payroll' }]} />
      {due.length > 0 && (
        <Section title="Statutory payments due" hint="PAYE, NSSA, ZIMDEF and the AIDS levy, soonest first.">
          <table className="w-full min-w-[30rem]">
            <tbody>
              {due.map((d) => (
                <tr key={d.id} className="border-t border-line">
                  <Td>{d.type.replace('_', ' ')} · {d.period}</Td><Td className="text-right"><Money cents={d.amountCents} currency={d.currency} /></Td>
                  <Td className={d.daysLeft < 0 ? 'text-danger' : ''}>{d.daysLeft < 0 ? `${-d.daysLeft} days overdue` : d.daysLeft === 0 ? 'Due today' : `Due in ${d.daysLeft} days`} ({d.dueDate})</Td>
                  <Td><FormAction label="Mark paid" size="sm" url={`/api/finance/statutory/${d.id}/pay`} done="Recorded as paid" fields={[{ name: 'reference', label: 'Payment reference', required: true, maxLength: 80 }]} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
      {runs.length === 0 && <Notice tone="info">No payroll has been handed over yet. When HR has prepared a payroll and the Owner has approved it, it appears here as “Ready to pay”.</Notice>}
      {runs.map((r) => {
        const mine = false;
        void mine;
        const unpaid = r.lines.filter((l) => !l.paid);
        return (
          <Section key={r.id} title={`${r.period}`} hint={`Prepared by ${r.preparedBy}, approved by ${r.approvedBy}${r.paidBy ? `, paid by ${r.paidBy}` : ''}.`}
            action={<div className="flex flex-wrap items-center gap-2"><StatusBadge status={r.status} />{unpaid.length > 0 && <a className="text-sm underline" href={`/api/finance/payroll/${r.id}/bank-file`}>Bank file (CSV)</a>}</div>}>
            <p className="mb-2 text-sm text-ink">Net pay: <MoneyLine totals={r.totals} /> · paid so far: <MoneyLine totals={r.paidTotals} empty="nothing" /></p>
            {unpaid.length > 0 && <div className="mb-2"><RowAction label={`Mark all ${unpaid.length} unpaid as paid`} variant="primary" url={`/api/finance/payroll/${r.id}/pay`} body={{ lineIds: unpaid.map((l) => l.id) }} fields={[{ name: 'reference', label: 'Batch reference (optional)', optional: true }]} confirm="Mark every unpaid line as paid? A Salaries expense is recorded for each." done="Marked paid" /></div>}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem]">
                <thead><tr><Th>Employee</Th><Th>Paid by</Th><Th>Account</Th><Th className="text-right">Net</Th><Th /></tr></thead>
                <tbody>
                  {r.lines.map((l) => (
                    <tr key={l.id} className="border-t border-line">
                      <Td>{l.employee}{l.employeeRef && <span className="text-xs text-muted"> · {l.employeeRef}</span>}</Td><Td>{methodLabel(l.method)}</Td><Td>{l.account ?? '—'}</Td><Td className="text-right"><Money cents={l.netCents} currency={l.currency} /></Td>
                      <Td>{l.paid ? <span className="text-xs text-muted">Paid{l.reference ? ` · ${l.reference}` : ''}</span> : <RowAction label="Mark paid" variant="secondary" url={`/api/finance/payroll/${r.id}/pay`} body={{ lineIds: [l.id] }} fields={[{ name: 'reference', label: 'Payment reference', optional: true }]} done="Marked paid" />}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        );
      })}
    </div>
  );
}

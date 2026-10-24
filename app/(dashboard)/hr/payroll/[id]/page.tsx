import { getHrAccess as getAccess } from '@/lib/hr/access';
import { getRun } from '@/lib/payroll/run';
import { listDirectory } from '@/lib/hr/employees';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Money } from '@/components/finance/format';
import { Notice, RowAction, Section, Td, Th } from '@/components/finance/shared';
import { HrNav } from '@/components/hr/HrNav';

export const metadata = { title: 'Payroll run · Pfuma' };
type Cur = 'USD' | 'ZIG';
type Item = { code: string; label: string; amountCents: number };
type Totals = { total: Record<Cur, { people: number; grossCents: number; payeCents: number; aidsLevyCents: number; nssaEmployeeCents: number; nssaEmployerCents: number; zimdefCents: number; netCents: number; costToSchoolCents: number }> } | null;

export default async function RunPage({ params }: { params: { id: string } }) {
  const { user, can } = await getAccess();
  let r;
  try { r = await getRun(user, params.id); } catch (e) { if (e instanceof ServiceError && e.status < 500) return <AccessDenied message={e.status === 404 ? 'This payroll run does not exist.' : undefined} />; throw e; }
  const t = r.totals as Totals;
  const open = r.status === 'DRAFT' || r.status === 'RETURNED';
  const prepare = can('hr.payroll.prepare') && r.isPreparer && open;
  const people = prepare ? (await listDirectory(user, { employer: 'SCHOOL', pageSize: 500 })).items : [];
  const owner = can('hr.payroll.approve');
  const flagged = r.lines.filter((l) => (l.flags as unknown[]).length > 0);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title={`Payroll for ${r.month}`} description={`Prepared by ${r.preparedBy}${r.approvedBy ? `, approved by ${r.approvedBy}` : ''}${r.paidBy ? `, paid by ${r.paidBy}` : ''}.`} breadcrumbs={[{ label: 'HR & Staff', href: '/hr' }, { label: 'Payroll', href: '/hr/payroll' }, { label: r.month }]}
        actions={<div className="flex flex-wrap items-center gap-2"><Badge variant={r.status === 'PAID' ? 'success' : r.status === 'RETURNED' ? 'danger' : r.status === 'APPROVED' ? 'info' : 'warning'} label={r.status.charAt(0) + r.status.slice(1).toLowerCase()} />
          {prepare && <RowAction label="Recalculate" url={`/api/hr/payroll/runs/${r.id}/recalculate`} done="Recalculated" />}
          {prepare && <RowAction label="Submit for approval" variant="primary" url={`/api/hr/payroll/runs/${r.id}/submit`} confirm="Submit this run? It is calculated again and then locked." done="Submitted" />}
          {owner && r.status === 'SUBMITTED' && !r.isPreparer && <>
            <RowAction label="Approve" variant="primary" url={`/api/hr/payroll/runs/${r.id}/approve`} confirm="Approve this payroll? It is locked and handed to Finance to pay." done="Approved and handed to Finance" />
            <RowAction label="Return" variant="danger" url={`/api/hr/payroll/runs/${r.id}/return`} reason={{ label: 'What needs to change?', field: 'comment', min: 3 }} done="Returned" /></>}
          {owner && r.status === 'APPROVED' && <RowAction label="Reopen" variant="danger" url={`/api/hr/payroll/runs/${r.id}/reopen`} reason={{ label: 'Why is it reopened?', min: 5 }} done="Reopened" />}</div>} />
      <HrNav can={can} current="/hr/payroll" />
      {r.returnComment && r.status === 'RETURNED' && <Notice tone="danger">Returned by the Owner: {r.returnComment}</Notice>}
      {r.reopenReason && r.status === 'DRAFT' && <Notice tone="warn">Reopened by the Owner: {r.reopenReason}</Notice>}
      {r.status === 'SUBMITTED' && r.isPreparer && <Notice tone="info">Submitted. The Owner approves it; you prepared it, so you cannot.</Notice>}
      {(['USD', 'ZIG'] as Cur[]).filter((c) => t && t.total[c].people > 0).map((c) => (
        <Section key={c} title={c === 'USD' ? 'Totals in US dollars' : 'Totals in ZiG'} hint="Each currency is worked out and totalled on its own.">
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            {([['People', null, t!.total[c].people], ['Gross', t!.total[c].grossCents], ['PAYE', t!.total[c].payeCents], ['AIDS levy', t!.total[c].aidsLevyCents], ['NSSA (employees)', t!.total[c].nssaEmployeeCents], ['Net pay', t!.total[c].netCents], ['NSSA (employer)', t!.total[c].nssaEmployerCents], ['ZIMDEF', t!.total[c].zimdefCents], ['Total cost to the school', t!.total[c].costToSchoolCents]] as [string, number | null, number?][]).map(([k, cents, n]) => (
              <div key={k}><dt className="text-muted">{k}</dt><dd className="font-semibold text-ink">{cents == null ? n : <Money cents={cents} currency={c} />}</dd></div>
            ))}
          </dl>
        </Section>
      ))}
      {flagged.length > 0 && <Notice tone="warn">{flagged.length} line{flagged.length === 1 ? '' : 's'} need a look: a net pay that moved more than 10% or a problem. They are marked below.</Notice>}
      <Section title="Lines" hint="Government-paid staff are never in a payroll."
        action={prepare && <FormAction label="Add a one-off item" url={`/api/hr/payroll/runs/${r.id}/variables`} done="Added. Recalculate to see it." intro="Overtime, a bonus, a deduction, unpaid days, casual days or hours, or a correction of an earlier month (which needs a reason)."
          fields={[{ name: 'employeeId', label: 'Employee', type: 'select', required: true, options: people.map((p) => ({ value: p.id, label: p.name })) },
            { name: 'kind', label: 'What', type: 'select', required: true, options: [{ value: 'OVERTIME', label: 'Overtime (hours × rate)' }, { value: 'BONUS', label: 'Bonus' }, { value: 'DEDUCTION', label: 'Deduction' }, { value: 'UNPAID_DAYS', label: 'Unpaid days' }, { value: 'CASUAL_UNITS', label: 'Casual days or hours worked' }, { value: 'ADJUSTMENT', label: 'Correction of an earlier month' }] },
            { name: 'label', label: 'Description', required: true }, { name: 'amountCents', label: 'Amount (for a correction, negative takes money back)', type: 'cents' }, { name: 'units', label: 'Hours or days', type: 'number' }, { name: 'rateCents', label: 'Rate per hour (overtime)', type: 'cents' },
            { name: 'currency', label: 'Currency', type: 'select', options: [{ value: 'USD', label: 'US dollars' }, { value: 'ZIG', label: 'ZiG' }] }, { name: 'reason', label: 'Reason (needed for a correction)', type: 'textarea' }]} />}>
        <div className="overflow-x-auto"><table className="w-full min-w-[56rem]"><thead><tr><Th>Employee</Th><Th>Currency</Th><Th className="text-right">Gross</Th><Th className="text-right">PAYE</Th><Th className="text-right">AIDS</Th><Th className="text-right">NSSA</Th><Th className="text-right">Other</Th><Th className="text-right">Net</Th><Th className="text-right">Last month</Th></tr></thead><tbody>
          {r.lines.map((l) => {
            const c = l.currency as Cur; const other = (l.deductions as Item[]).reduce((s, d) => s + d.amountCents, 0); const fl = l.flags as { code: string; message: string }[];
            return (
              <tr key={l.id} className={`border-t border-line align-top ${fl.length ? 'bg-warn-bg/40' : ''}`}>
                <Td>{l.name}<div className="text-xs text-muted">{l.employeeNo}{l.department ? ` · ${l.department}` : ''}</div>{fl.map((f, i) => <div key={i} className="mt-1 text-xs text-warn">{f.message}</div>)}</Td><Td>{c}</Td>
                <Td className="text-right"><Money cents={l.grossCents} currency={c} /></Td><Td className="text-right"><Money cents={l.payeCents} currency={c} /></Td><Td className="text-right"><Money cents={l.aidsLevyCents} currency={c} /></Td>
                <Td className="text-right"><Money cents={l.nssaEmployeeCents} currency={c} /></Td><Td className="text-right"><Money cents={other} currency={c} /></Td><Td className="text-right font-semibold"><Money cents={l.netCents} currency={c} /></Td>
                <Td className="text-right">{l.previousNetCents != null ? <Money cents={l.previousNetCents} currency={c} /> : '—'}</Td>
              </tr>);
          })}
          {r.lines.length === 0 && <tr><Td className="text-muted">Nobody yet. Set up pay for the school-paid staff first (Staff, a person, Pay).</Td></tr>}
        </tbody></table></div>
      </Section>
      {r.variables.length > 0 && (
        <Section title="One-off items">
          <table className="w-full"><thead><tr><Th>Employee</Th><Th>What</Th><Th className="text-right">Amount</Th><Th>Reason</Th><Th /></tr></thead><tbody>
            {r.variables.map((v) => (<tr key={v.id} className="border-t border-line"><Td>{v.employee}</Td><Td>{v.label}</Td><Td className="text-right">{v.units != null && v.amountCents === 0 ? `${v.units}` : <Money cents={v.amountCents} currency={v.currency as Cur} />}</Td><Td>{v.reason ?? ''}</Td>
              <Td>{prepare && <RowAction label="Remove" variant="ghost" url={`/api/hr/payroll/runs/${r.id}/variables/${v.id}`} method="DELETE" confirm="Remove this item?" done="Removed" />}</Td></tr>))}
          </tbody></table>
        </Section>
      )}
    </div>
  );
}

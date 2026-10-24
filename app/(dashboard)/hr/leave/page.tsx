import { getHrAccess as getAccess } from '@/lib/hr/access';
import { listLeaveRequests, listLeaveTypes } from '@/lib/hr/leave';
import { listDirectory } from '@/lib/hr/employees';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Notice, RowAction, Section, Td, Th } from '@/components/finance/shared';
import { HrNav } from '@/components/hr/HrNav';

export const metadata = { title: 'Leave · Pfuma' };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export default async function LeavePage({ searchParams }: { searchParams: { status?: string } }) {
  const { user, can } = await getAccess();
  if (!can('hr.leave.view_all') && !can('hr.leave.approve')) return <AccessDenied />;
  const status = (['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).find((s) => s === searchParams.status) ?? 'PENDING';
  const [rows, types, staff] = await Promise.all([listLeaveRequests(user, { status }), listLeaveTypes(user), can('hr.leave.adjust') ? listDirectory(user, { pageSize: 500 }) : null]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Leave" description="Requests from staff. The Head decides; for teaching staff the Head can delegate to the Deputy. Nobody approves their own leave."
        actions={can('hr.leave.adjust') && staff && (
          <FormAction label="Adjust a balance" size="md" url="/api/hr/leave/adjust" done="Balance adjusted" intro="For opening balances when the school starts using Pfuma, or a correction. The reason is kept."
            fields={[{ name: 'employeeId', label: 'Employee', type: 'select', required: true, options: staff.items.map((s) => ({ value: s.id, label: s.name })) }, { name: 'leaveTypeId', label: 'Leave type', type: 'select', required: true, options: types.map((t) => ({ value: t.id, label: t.name })) },
              { name: 'year', label: 'Year', type: 'number', required: true, initial: String(new Date().getFullYear()) }, { name: 'days', label: 'Days to add (negative to take off)', type: 'number', required: true }, { name: 'reason', label: 'Reason', type: 'textarea', required: true }]} />
        )} />
      <HrNav can={can} current="/hr/leave" />
      <div className="flex gap-2">{(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map((s) => (<a key={s} href={`/hr/leave?status=${s}`} className={`rounded-full px-4 py-2 text-sm font-semibold ${s === status ? 'bg-primary text-white' : 'bg-white text-muted'}`}>{label(s)}</a>))}</div>
      <Section title={`${label(status)} requests`}>
        {rows.length === 0 ? <p className="text-sm text-muted">Nothing here.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[44rem]"><thead><tr><Th>Employee</Th><Th>Type</Th><Th>Dates</Th><Th className="text-right">Days</Th><Th>Notes</Th><Th /></tr></thead><tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <Td>{r.employee}{r.recordOnly && <div className="text-xs text-muted">Government-paid: recorded for the school; the ministry decides.</div>}</Td><Td>{r.type}</Td><Td>{r.from} to {r.to}</Td><Td className="text-right">{r.days}</Td>
                <Td>{r.reason && <p>{r.reason}</p>}{r.handoverNotes && <p className="text-xs text-muted">Handover: {r.handoverNotes}</p>}{r.decisionReason && <p className="text-xs text-muted">{r.decisionReason}</p>}
                  {r.othersAway.length > 0 && <Notice tone="warn">Also away in the department: {r.othersAway.map((o) => `${o.employee} (${o.from} to ${o.to})`).join(', ')}</Notice>}</Td>
                <Td>{r.status === 'PENDING' ? (can('hr.leave.approve') && !r.mine ? (
                  <div className="flex gap-2"><RowAction label="Approve" variant="primary" url={`/api/hr/leave/requests/${r.id}/decision`} body={{ decision: 'APPROVE' }} done="Approved" />
                    <RowAction label="Reject" variant="danger" url={`/api/hr/leave/requests/${r.id}/decision`} body={{ decision: 'REJECT' }} reason={{ label: 'Why is it rejected?', min: 3 }} done="Rejected" /></div>) : <span className="text-xs text-muted">{r.mine ? 'Yours: someone else decides' : ''}</span>)
                  : r.status === 'APPROVED' && can('hr.leave.approve') && !r.mine ? <RowAction label="Cancel" variant="ghost" url={`/api/hr/leave/requests/${r.id}/cancel`} reason={{ label: 'Why is it cancelled?', min: 3 }} done="Cancelled" /> : <Badge variant={r.status === 'APPROVED' ? 'success' : 'neutral'} label={label(r.status)} />}</Td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Section>
      <Section title="Leave types" hint="Defaults to confirm against the Labour Act and the relevant NEC or public service rules. HR can change them.">
        <div className="overflow-x-auto"><table className="w-full min-w-[40rem]"><thead><tr><Th>Type</Th><Th className="text-right">Days a year</Th><Th>Rules</Th><Th /></tr></thead><tbody>
          {types.map((t) => (
            <tr key={t.id} className="border-t border-line"><Td>{t.name}</Td><Td className="text-right">{t.daysPerYear || '—'}</Td>
              <Td className="text-xs text-muted">{[t.accruesMonthly && 'accrues monthly', t.carryOverMax > 0 && `carry over up to ${t.carryOverMax}`, t.fullPayDays != null && `${t.fullPayDays} days full pay`, t.halfPayDays != null && `${t.halfPayDays} half pay`, t.certificateAfterDays != null && `certificate after ${t.certificateAfterDays} days`, t.requiresAttachment && 'document needed', t.unpaid && 'unpaid (feeds payroll)', !t.deductsBalance && 'not taken off a balance', t.calendarDays && 'calendar days'].filter(Boolean).join(' · ')}</Td>
              <Td>{can('hr.leave.adjust') && (
                <FormAction label="Edit" url="/api/hr/leave/types" done="Saved" extra={{ id: t.id, code: t.code, name: t.name, accruesMonthly: t.accruesMonthly, requiresAttachment: t.requiresAttachment, deductsBalance: t.deductsBalance, unpaid: t.unpaid, calendarDays: t.calendarDays, active: t.active, ...(t.fullPayDays != null ? { fullPayDays: t.fullPayDays } : {}), ...(t.halfPayDays != null ? { halfPayDays: t.halfPayDays } : {}), ...(t.certificateAfterDays != null ? { certificateAfterDays: t.certificateAfterDays } : {}) }}
                  fields={[{ name: 'daysPerYear', label: 'Days a year', type: 'number', required: true, initial: String(t.daysPerYear) }, { name: 'carryOverMax', label: 'Carry-over limit', type: 'number', initial: String(t.carryOverMax) }, { name: 'reason', label: 'Reason for the change', required: true }]} />)}</Td></tr>
          ))}
        </tbody></table></div>
      </Section>
    </div>
  );
}

import Link from 'next/link';
import { getHrAccess as getAccess } from '@/lib/hr/access';
import { getMyRecord, listChangeRequests } from '@/lib/hr/employees';
import { getBalances, listColleagues, listLeaveRequests, listLeaveTypes } from '@/lib/hr/leave';
import { myAttendance } from '@/lib/hr/attendance';
import { myDuties, listSwaps } from '@/lib/hr/duties';
import { listMyPayslips } from '@/lib/payroll/payslip';
import { getScopedDb } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { todayInHarare } from '@/lib/hr/common';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Money } from '@/components/finance/format';
import { Notice, RowAction, Section, Td, Th } from '@/components/finance/shared';
import { HrNav } from '@/components/hr/HrNav';
import { ChangeRequestForm, LeaveRequestForm } from '@/components/hr/MyForms';
import { SignInButton } from '@/components/hr/RegisterForm';

export const metadata = { title: 'My HR · Pfuma' };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export default async function MyHrPage() {
  const { user, can } = await getAccess();
  if (!can('hr.self.details')) return <AccessDenied />;
  let me;
  try { me = await getMyRecord(user); } catch (e) {
    if (e instanceof ServiceError && e.status === 404) return (
      <div className="flex flex-col gap-4 pb-8"><PageHeader title="My HR" /><Notice tone="info">You have no staff record yet. Ask HR to link your login to your staff record, and your payslips, leave and duties will appear here.</Notice></div>
    );
    throw e;
  }
  const today = todayInHarare();
  const [balances, requests, types, colleagues, att, duties, swaps, slips, changes, settings] = await Promise.all([
    can('hr.self.leave') ? getBalances(user) : [], can('hr.self.leave') ? listLeaveRequests(user, {}) : [], can('hr.leave.request') ? listLeaveTypes(user) : [], can('hr.leave.request') ? listColleagues(user) : [],
    can('hr.attendance.self') ? myAttendance(user) : null, myDuties(user), listSwaps(user).catch(() => []), can('hr.self.payslips') ? listMyPayslips(user) : [], listChangeRequests(user),
    getScopedDb(user.schoolId, user.id).hrSettings.findUnique({ where: { schoolId: user.schoolId } }),
  ]);
  const todayRow = att?.rows.find((r) => r.date === today);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="My HR" description={`${me.name} · ${me.employeeNo} · ${me.jobTitle}`} />
      <HrNav can={can} current="/hr/me" />

      {settings?.selfSignIn && can('hr.attendance.self') && (
        <Section title="Today" hint={`Sign in when you arrive. After ${settings.lateAfter} you are marked late.`}>
          {todayRow ? <p className="text-sm text-ink">You are marked <b>{todayRow.status.toLowerCase().replace('_', ' ')}</b>{todayRow.arrivalTime ? ` (${todayRow.arrivalTime})` : ''}.</p> : <SignInButton />}
          {settings.signOutRequired && todayRow && !todayRow.departureTime && <div className="mt-2"><SignInButton label="Sign out" url="/api/hr/attendance/sign-out" /></div>}
        </Section>
      )}

      {can('hr.self.payslips') && (
        <Section title="My payslips" hint="Released when the payroll is paid.">
          <ul className="divide-y divide-line">{slips.map((s) => (<li key={s.runId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><Link className="font-semibold text-primary hover:underline" href={`/hr/me/payslips/${s.runId}`}>{s.month}</Link><span className="text-muted">{s.net.map((n, i) => <span key={i} className="ml-3"><Money cents={n.netCents} currency={n.currency as 'USD' | 'ZIG'} /></span>)}</span></li>))}
            {slips.length === 0 && <li className="py-2 text-sm text-muted">No payslips yet.</li>}</ul>
          {slips.length > 0 && <p className="mt-2 text-sm"><Link className="underline" href="/hr/me/year-end">Year-end summary for tax</Link></p>}
        </Section>
      )}

      {can('hr.self.leave') && (
        <Section title="My leave" action={can('hr.leave.request') && <LeaveRequestForm types={types.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name }))} colleagues={colleagues} />}>
          <div className="overflow-x-auto"><table className="mb-4 w-full min-w-[34rem]"><thead><tr><Th>Type</Th><Th className="text-right">Earned</Th><Th className="text-right">Taken</Th><Th className="text-right">Pending</Th><Th className="text-right">Left</Th></tr></thead><tbody>
            {balances.filter((b) => b.limited).map((b) => (<tr key={b.typeId} className="border-t border-line"><Td>{b.name}</Td><Td className="text-right">{b.accrued + b.carriedOver + b.adjusted}</Td><Td className="text-right">{b.taken}</Td><Td className="text-right">{b.pending}</Td><Td className="text-right font-semibold">{b.remaining}</Td></tr>))}
          </tbody></table></div>
          <table className="w-full"><thead><tr><Th>Type</Th><Th>Dates</Th><Th className="text-right">Days</Th><Th>Status</Th><Th /></tr></thead><tbody>
            {requests.map((r) => (<tr key={r.id} className="border-t border-line"><Td>{r.type}</Td><Td>{r.from} to {r.to}</Td><Td className="text-right">{r.days}</Td><Td><Badge variant={r.status === 'APPROVED' ? 'success' : r.status === 'PENDING' ? 'warning' : 'neutral'} label={label(r.status)} />{r.decisionReason && <span className="ml-2 text-xs text-muted">{r.decisionReason}</span>}</Td>
              <Td>{r.status === 'PENDING' && <RowAction label="Cancel" variant="ghost" url={`/api/hr/leave/requests/${r.id}/cancel`} confirm="Cancel this request?" done="Cancelled" />}</Td></tr>))}
            {requests.length === 0 && <tr><Td className="text-muted">No requests yet.</Td></tr>}
          </tbody></table>
        </Section>
      )}

      <Section title="My duties" hint="From the published roster.">
        <ul className="divide-y divide-line">{duties.map((d) => (<li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span><b>{d.date}</b> · {d.duty}{d.swap && <span className="ml-2 text-xs text-muted">swap {d.swap === 'ACCEPTED' ? 'accepted, waiting for the Deputy' : 'asked'}</span>}</span>
          {!d.swap && <FormAction label="Ask to swap" variant="ghost" url="/api/hr/duties/swaps" extra={{ assignmentId: d.id }} done="Asked" fields={[{ name: 'toEmployeeId', label: 'Colleague', type: 'select', required: true, options: colleagues.map((c) => ({ value: c.id, label: c.name })) }, { name: 'reason', label: 'Reason' }]} />}</li>))}
          {duties.length === 0 && <li className="py-2 text-sm text-muted">No duties coming up.</li>}</ul>
        {swaps.filter((s) => s.mineToAnswer).map((s) => (<div key={s.id} className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-tint p-3 text-sm">{s.from} asked you to take the duty on {s.date}.<RowAction label="Accept" variant="primary" url={`/api/hr/duties/swaps/${s.id}/reply`} body={{ accept: true }} done="Accepted" /><RowAction label="Decline" variant="ghost" url={`/api/hr/duties/swaps/${s.id}/reply`} body={{ accept: false }} done="Declined" /></div>))}
      </Section>

      {att && can('hr.attendance.self') && (
        <Section title="My attendance" hint={`${att.month}: late ${att.late} time${att.late === 1 ? '' : 's'}, absent ${att.absent} day${att.absent === 1 ? '' : 's'}.`}>
          <ul className="divide-y divide-line">{att.rows.slice(0, 31).map((r) => (<li key={r.date} className="py-1.5 text-sm">{r.date} · {r.status.toLowerCase().replace('_', ' ')}{r.arrivalTime ? ` · ${r.arrivalTime}` : ''}</li>))}{att.rows.length === 0 && <li className="py-2 text-sm text-muted">Nothing recorded this month.</li>}</ul>
        </Section>
      )}

      <Section title="My details" hint="Changes go to HR for approval; bank or EcoCash changes also need the Owner.">
        <dl className="mb-3 grid gap-1 text-sm sm:grid-cols-2"><div><dt className="text-muted">Address</dt><dd>{me.personal?.homeAddress ?? '—'}</dd></div><div><dt className="text-muted">Phone</dt><dd>{me.personal?.personalPhone ?? '—'}</dd></div><div><dt className="text-muted">Email</dt><dd>{me.personal?.personalEmail ?? '—'}</dd></div><div><dt className="text-muted">Next of kin</dt><dd>{me.nextOfKin.map((k) => `${k.name} (${k.relationship})`).join(', ') || '—'}</dd></div></dl>
        <div className="flex flex-wrap gap-2"><ChangeRequestForm group="DETAILS" />{me.employer === 'SCHOOL' && <ChangeRequestForm group="BANK" />}<ChangeRequestForm group="NEXT_OF_KIN" /></div>
        {changes.length > 0 && <ul className="mt-3 divide-y divide-line text-sm">{changes.slice(0, 6).map((c) => (<li key={c.id} className="py-1.5">{label(c.group)} · {c.createdAt.slice(0, 10)} · <b>{c.status === 'HR_APPROVED' ? 'waiting for the Owner' : label(c.status)}</b>{c.rejectionReason ? ` (${c.rejectionReason})` : ''}</li>))}</ul>}
      </Section>

      <Section title="My documents" hint="Contract, appointment letter and certificates.">
        <ul className="divide-y divide-line">{me.documents.map((d) => (<li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm"><span>{d.title} <span className="text-muted">{d.reference ? `· ${d.reference}` : ''}</span></span>{d.body && <Link className="text-primary underline" href={`/hr/letters/${d.id}`}>Open</Link>}</li>))}{me.documents.length === 0 && <li className="py-2 text-sm text-muted">None yet.</li>}</ul>
      </Section>
    </div>
  );
}

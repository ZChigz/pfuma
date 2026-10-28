import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { calendarOptions, listExeats, listVisitors, TYPE_LABEL, visitingDays, HEAD_TYPES } from '@/lib/facilities/exeats';
import { listHostels } from '@/lib/facilities/hostel';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { RowAction, Section } from '@/components/finance/shared';
import { HostelNav } from '@/components/facilities/HostelNav';
import { BulkExeatForm, ExeatRequestForm, VisitorForm } from '@/components/facilities/ExeatForms';

export const metadata = { title: 'Exeats · Pfuma' };
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Harare' });
const TONE = { REQUESTED: 'warning', APPROVED: 'info', SIGNED_OUT: 'warning', RETURNED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' } as const;

export default async function ExeatsPage() {
  const { user, can } = await getAccess();
  const request = can('facilities.exeats.request');
  const approve = can('facilities.exeats.approve');
  const sign = can('facilities.exeats.signout');
  const visitors = can('facilities.visitors.log');
  if (!request && !approve && !sign && !visitors) return <AccessDenied />;
  const [rows, hostels, events, days, visits] = await Promise.all([
    request || approve || sign ? listExeats(user) : Promise.resolve([]),
    request ? listHostels(user).catch(() => []) : Promise.resolve([]),
    request ? calendarOptions(user).catch(() => []) : Promise.resolve([]),
    visitors || request ? visitingDays(user).catch(() => []) : Promise.resolve([]),
    visitors || request ? listVisitors(user).catch(() => []) : Promise.resolve([]),
  ]);
  const late = rows.filter((r) => r.overdueMinutes > 0);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Exeats and visiting days" description="Boarders leaving school: recorded, approved, signed out and in at the gate." />
      <HostelNav can={can} current="/facilities/exeats" />
      {sign && <Link href="/facilities/exeats/gate" className="inline-flex min-h-[56px] items-center justify-center rounded-xl bg-primary text-base font-bold text-white">Open the gate</Link>}
      {late.length > 0 && (
        <Section title={`Not back (${late.length})`}>
          <ul className="flex flex-col gap-2">{late.map((r) => <li key={r.id} className="rounded-xl bg-danger-bg p-3 text-sm text-danger"><b>{r.student}</b> · {r.hostel ?? r.className} · {Math.floor(r.overdueMinutes / 60)} h {r.overdueMinutes % 60} min late</li>)}</ul>
        </Section>
      )}
      <Section title="Open exeats">
        {rows.length === 0 ? <p className="text-sm text-muted">None open.</p> : (
          <ul className="flex flex-col gap-2">{rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-line bg-white p-3 text-sm">
              <p className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-ink">{r.student} <span className="font-normal text-muted">· {r.className ?? r.admissionNumber}</span></span><Badge variant={TONE[r.status as keyof typeof TONE] ?? 'neutral'} label={r.status === 'SIGNED_OUT' ? 'Out' : r.status.charAt(0) + r.status.slice(1).toLowerCase()} /></p>
              <p className="text-xs text-muted">{TYPE_LABEL[r.type as keyof typeof TYPE_LABEL]} · {when(r.outAt)} to {when(r.dueBackAt)} · {r.reason}</p>
              <p className="text-xs text-muted">Recorded by {r.requestedBy}{r.collector ? ` · collector ${r.collector}` : ''}</p>
              {r.status === 'REQUESTED' && (HEAD_TYPES.includes(r.type) ? approve && r.requestedById !== user.id : request || approve) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <RowAction label="Approve" variant="primary" url={`/api/facilities/exeats/${r.id}/decide`} body={{ decision: 'APPROVE' }} done="Approved" />
                  <RowAction label="Refuse" variant="ghost" url={`/api/facilities/exeats/${r.id}/decide`} body={{ decision: 'REJECT' }} reason={{ label: 'Why is it refused?', min: 3 }} done="Refused" />
                </div>
              )}
              {(r.status === 'REQUESTED' || r.status === 'APPROVED') && (request || approve) && (
                <div className="mt-2"><RowAction label="Cancel" variant="ghost" url={`/api/facilities/exeats/${r.id}/cancel`} body={{}} reason={{ label: 'Why is it cancelled?', min: 3 }} done="Cancelled" /></div>
              )}
            </li>
          ))}</ul>
        )}
      </Section>
      {request && <Section title="Record an exeat"><ExeatRequestForm canApprove /></Section>}
      {request && <Section title="Exeat weekend from the Calendar"><BulkExeatForm hostels={hostels.filter((h) => h.active).map((h) => ({ id: h.id, name: h.name }))} events={events.map((e) => ({ id: e.id, title: e.title, startDate: e.startDate, endDate: e.endDate }))} /></Section>}
      {(visitors || request) && (
        <Section title="Visiting days and visitors">
          {days.length === 0 ? <p className="text-sm text-muted">No visiting day is set on the Calendar in the next 60 days.</p> : <ul className="mb-3 text-sm">{days.map((d) => <li key={d.id}>{d.today ? <b>Today: </b> : null}{d.title} · {d.startDate}{d.endDate !== d.startDate ? ` to ${d.endDate}` : ''}</li>)}</ul>}
          {visitors && <VisitorForm canApproveOthers={request} />}
          <ul className="mt-3 flex flex-col gap-2">{visits.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white p-3 text-sm">
              <span><b>{v.visitor}</b> to see {v.student} <span className="text-muted">· {v.guardian ? 'guardian' : 'approved'} · in {new Date(v.timeIn).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Harare' })}</span></span>
              {v.timeOut ? <Badge variant="neutral" label="Left" /> : visitors && <RowAction label="Left" variant="secondary" url={`/api/facilities/exeats/visitors/${v.id}/out`} body={{}} done="Logged" />}
            </li>
          ))}</ul>
        </Section>
      )}
    </div>
  );
}

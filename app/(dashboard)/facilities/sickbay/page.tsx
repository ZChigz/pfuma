import { getAccess } from '@/lib/access';
import { COMPLAINT_LABEL, OUTCOME_LABEL, listVisits, sickBayMedicine, sickBaySummary } from '@/lib/facilities/sickbay';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { RowAction, Section } from '@/components/finance/shared';
import { SickBayNav } from '@/components/facilities/SickBayNav';
import { SickBayVisitForm } from '@/components/facilities/SickBayVisitForm';

export const metadata = { title: 'Sick bay · Pfuma' };
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Harare' });

export default async function SickBayPage() {
  const { user, can } = await getAccess();
  const record = can('facilities.sickbay.record');
  if (!record && !can('facilities.sickbay.view')) return <AccessDenied />;
  const [summary, visits, medicine] = await Promise.all([sickBaySummary(user), listVisits(user), record ? sickBayMedicine(user) : Promise.resolve([])]);
  const resting = visits.filter((v) => v.admittedAt && !v.dischargedAt);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Sick bay" description="Visits, learners resting, clinic referrals and medicine given. Only the matron and the nurse see these details; teachers see just that a learner is in the sick bay." />
      <SickBayNav can={can} current="/facilities/sickbay" />
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        {([['In the sick bay', summary.inNow], ['Visits today', summary.visitsToday], ['Missed doses today', summary.missedToday]] as const).map(([k, n]) => <div key={k} className="rounded-xl bg-white p-3"><p className="text-2xl font-bold text-ink">{n}</p><p className="text-xs text-muted">{k}</p></div>)}
      </div>
      {resting.length > 0 && (
        <Section title="Resting in the sick bay">
          <ul className="flex flex-col gap-2">{resting.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white p-3 text-sm">
              <span><b>{v.student}</b> <span className="text-muted">· {v.className ?? v.admissionNumber} · since {when(v.admittedAt!)}</span></span>
              {record && <RowAction label="Discharge" variant="primary" url={`/api/facilities/sickbay/${v.id}/discharge`} body={{}} done="Discharged" />}
            </li>
          ))}</ul>
        </Section>
      )}
      {record && <Section title="Record a visit"><SickBayVisitForm medicine={medicine.map((m) => ({ itemId: m.itemId, name: m.name, unit: m.unit, qty: m.qty }))} /></Section>}
      <Section title="Recent visits">
        {visits.length === 0 ? <p className="text-sm text-muted">None in the last two weeks.</p> : (
          <ul className="flex flex-col gap-2">{visits.map((v) => (
            <li key={v.id} className="rounded-xl border border-line bg-white p-3 text-sm">
              <p className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-ink">{v.student} <span className="font-normal text-muted">· {v.className ?? v.admissionNumber} · {when(v.visitedAt)}</span></span>
                <Badge variant={v.outcome === 'BACK_TO_CLASS' ? 'success' : v.outcome === 'SENT_HOME' || v.outcome === 'SENT_TO_CLINIC' ? 'warning' : 'info'} label={OUTCOME_LABEL[v.outcome as keyof typeof OUTCOME_LABEL] ?? v.outcome} /></p>
              <p className="text-xs text-muted">{COMPLAINT_LABEL[v.complaint as keyof typeof COMPLAINT_LABEL] ?? v.complaint}{v.complaintNote ? `: ${v.complaintNote}` : ''}{v.temperatureC ? ` · ${v.temperatureC} °C` : ''}{v.treatment ? ` · ${v.treatment}` : ''}</p>
              {v.medication.length > 0 && <p className="text-xs text-muted">Given: {v.medication.map((m) => m.name + (m.dose ? ` ${m.dose}` : '')).join(', ')}</p>}
              {v.referral && <p className="text-xs text-muted">Referred to {v.referral.facility} by {v.referral.transport}, with {v.referral.accompaniedBy}</p>}
              <p className="text-xs text-muted">{v.guardianInformedAt ? `Guardian told (${v.guardianInformedMethod})` : 'Guardian not told'}</p>
            </li>
          ))}</ul>
        )}
      </Section>
    </div>
  );
}

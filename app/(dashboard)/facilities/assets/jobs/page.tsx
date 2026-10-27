import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { openJobs } from '@/lib/facilities/assets';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Section } from '@/components/finance/shared';
import { AssetNav } from '@/components/facilities/AssetNav';

export const metadata = { title: 'Faults · Assets · Pfuma' };

export default async function JobsPage() {
  const { user, can } = await getAccess();
  if (!['view', 'manage', 'maintain', 'dispose', 'verify'].some((k) => can(`facilities.assets.${k}` as never))) return <AccessDenied />;
  const jobs = await openJobs(user);
  const maintain = can('facilities.assets.maintain');
  const staff = maintain ? await getScopedDb(user.schoolId, user.id).user.findMany({ where: { active: true, isSupport: false }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } }) : [];
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Faults" description="Reported by any member of staff. The bursar assigns it, records the work done, who did it and what it cost; the cost becomes an expense in Finance." />
      <AssetNav can={can} current="/facilities/assets/jobs" />
      <Section title={`${jobs.length} open`}>
        {jobs.length === 0 ? <p className="text-sm text-muted">No open faults.</p> : (
          <ul className="flex flex-col gap-2">{jobs.map((j) => (
            <li key={j.id} className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><Link className="font-mono font-semibold text-primary underline" href={`/facilities/assets/${j.assetId}`}>{j.tag}</Link> {j.asset} · {j.location}</span>
                <Badge variant={j.status === 'ASSIGNED' ? 'info' : 'warning'} label={j.status === 'ASSIGNED' ? `With ${j.assignedTo}` : 'Reported'} />
              </div>
              <p>{j.problem} <span className="text-xs text-muted">· {j.reportedBy}, {j.createdAt.slice(0, 10)}</span></p>
              {maintain && (
                <div className="flex flex-wrap gap-2">
                  <FormAction label="Assign" url={`/api/facilities/assets/jobs/${j.id}/assign`} done="Assigned" fields={[{ name: 'assignedToId', label: 'Who sees to it', type: 'select', required: true, options: staff.map((s) => ({ value: s.id, label: s.fullName })) }]} />
                  <FormAction label="Record the work" variant="primary" url={`/api/facilities/assets/jobs/${j.id}/complete`} done="Work recorded"
                    fields={[{ name: 'workDone', label: 'Work done', type: 'textarea', required: true }, { name: 'provider', label: 'Who did it (provider)' }, { name: 'costCents', label: 'Cost', type: 'cents' },
                      { name: 'currency', label: 'Currency', type: 'select', options: [{ value: 'USD', label: 'US dollars' }, { value: 'ZIG', label: 'ZiG' }] }, { name: 'nextServiceDate', label: 'Next service', type: 'date' }, { name: 'receiptKey', label: 'Receipt', type: 'file' }]} />
                </div>
              )}
            </li>
          ))}</ul>
        )}
      </Section>
    </div>
  );
}

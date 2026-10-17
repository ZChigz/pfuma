import { notFound } from 'next/navigation';
import { ServiceError } from '@/lib/api';
import { MODULES } from '@/lib/access-core';
import { getSchoolDetail } from '@/lib/platform/schools';
import { STAFF_ROLE_LABEL } from '@/lib/staff-roles';
import { formatDate, formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { SchoolControls } from '@/components/platform/SchoolControls';
import { InvoicesPanel } from '@/components/platform/InvoicesPanel';
import { SupportPanel } from '@/components/platform/SupportPanel';
import { STATUS_BADGE } from '@/components/platform/status';

export const metadata = { title: 'School · Pfuma Platform' };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

export default async function SchoolDetailPage({ params }: { params: { id: string } }) {
  let detail;
  try {
    detail = await getSchoolDetail(params.id);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  }
  const { school, modules, invoices, plans, people, audit } = detail;
  const status = STATUS_BADGE[school.status];

  return (
    <>
      <PageHeader
        title={school.name}
        description={`${school.province ?? 'No province'} · created ${formatDate(school.createdAt)}`}
        breadcrumbs={[{ label: 'Schools', href: '/platform' }, { label: school.name }]}
        actions={<Badge variant={status.variant} label={status.label} />}
      />

      {school.status === 'SUSPENDED' && (
        <p role="status" className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger">Suspended: {school.suspendedReason ?? 'no reason recorded'}. The school can sign in and look, but not add or change anything.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="At a glance">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-xs text-subtle">Plan</dt><dd>{school.plan?.name ?? 'None'}</dd></div>
            <div><dt className="text-xs text-subtle">Renewal date</dt><dd>{school.renewalDate ? formatDate(school.renewalDate) : '—'}</dd></div>
            <div><dt className="text-xs text-subtle">Students</dt><dd>{school._count.students}{school.studentLimit ? ` of ${school.studentLimit}` : ' (no limit)'}</dd></div>
            <div><dt className="text-xs text-subtle">Active users</dt><dd>{school._count.users}</dd></div>
          </dl>
          <h3 className="mt-4 text-xs font-medium text-subtle">Owners and Administrators</h3>
          <ul className="mt-1 divide-y divide-line text-sm">
            {people.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                <span className="font-medium">{p.fullName} <span className="font-normal text-muted">· {p.userRoles.map((r) => STAFF_ROLE_LABEL[r.role.key] ?? r.role.key).join(', ')}</span></span>
                <span className="break-all text-xs text-muted">{p.email}{p.invitePending ? ' · invited' : ''}{p.active ? '' : ' · deactivated'}</span>
              </li>
            ))}
          </ul>
        </Card>

        <SupportPanel schoolId={school.id} schoolName={school.name} />
      </div>

      <SchoolControls
        schoolId={school.id}
        status={school.status}
        planId={school.planId ?? ''}
        plans={plans.map((p) => ({ id: p.id, name: p.name }))}
        studentLimit={school.studentLimit}
        renewalDate={day(school.renewalDate)}
        modules={MODULES.map((m) => ({ key: m.key, label: m.label, on: modules[m.key] }))}
      />

      <InvoicesPanel
        schoolId={school.id}
        invoices={invoices.map((i) => ({ id: i.id, number: i.number, issuedOn: day(i.issuedOn), dueOn: day(i.dueOn), paidOn: day(i.paidOn), amount: i.amount.toFixed(2), currency: i.currency, description: i.description, status: i.status }))}
      />

      <Card title="Recent console activity for this school">
        {audit.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                <span><span className="font-medium">{a.action.replace(/_/g, ' ').toLowerCase()}</span> <span className="text-muted">· {a.admin.fullName}</span>{a.detail ? <span className="block break-words text-xs text-muted">{a.detail}</span> : null}</span>
                <span className="whitespace-nowrap text-xs text-subtle">{formatDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

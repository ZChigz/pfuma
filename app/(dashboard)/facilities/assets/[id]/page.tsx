import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { CONDITIONS, METHODS, getAsset, staffOptions } from '@/lib/facilities/assets';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Notice, Section, Td, Th } from '@/components/finance/shared';
import { AssetNav } from '@/components/facilities/AssetNav';

export const metadata = { title: 'Asset · Pfuma' };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const money = (c: number, cur: string) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;

export default async function AssetPage({ params }: { params: { id: string } }) {
  const { user, can } = await getAccess();
  if (!['view', 'manage', 'maintain', 'dispose', 'verify'].some((k) => can(`facilities.assets.${k}` as never))) return <AccessDenied />;
  const data = await getAsset(user, params.id).catch((e) => { if (e instanceof ServiceError && e.status === 404) return null; throw e; });
  if (!data) notFound();
  const { asset: a, transfers, jobs, schedules, disposal, pendingDisposal } = data;
  const manage = can('facilities.assets.manage');
  const maintain = can('facilities.assets.maintain');
  const people = manage ? await staffOptions(user) : [];
  const live = a.status !== 'DISPOSED';
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title={`${a.tag}: ${a.name}`} description={`${a.category} · ${a.location}${a.custodian ? ` · ${a.custodian}` : ''}`} breadcrumbs={[{ label: 'Assets', href: '/facilities/assets' }, { label: a.tag }]}
        actions={live && (
          <div className="flex flex-wrap gap-2">
            <FormAction label="Report a fault" size="md" variant="primary" url="/api/facilities/assets/faults" done="Fault reported" extra={{ assetId: a.id }}
              fields={[{ name: 'problem', label: 'What is wrong?', type: 'textarea', required: true }, { name: 'photoKey', label: 'Photo', type: 'file' }]} />
            {manage && <FormAction label="Move or hand over" size="md" url="/api/facilities/assets/transfers" done="Moved" extra={{ assetId: a.id }}
              intro="The new custodian confirms on their phone that they have it."
              fields={[{ name: 'toLocation', label: 'New place', initial: a.location }, { name: 'toCustodianId', label: 'New custodian', type: 'select', initial: a.custodianId ?? '', options: people.map((p) => ({ value: p.id, label: p.name })) }, { name: 'date', label: 'Date', type: 'date' }]} />}
            {manage && <FormAction label="Edit" size="md" url={`/api/facilities/assets/${a.id}`} method="PATCH" done="Saved"
              fields={[{ name: 'name', label: 'Name', initial: a.name }, { name: 'condition', label: 'Condition', type: 'select', initial: a.condition, options: CONDITIONS.map((c) => ({ value: c, label: label(c) })) },
                { name: 'status', label: 'Status', type: 'select', initial: a.status === 'DISPOSED' ? '' : a.status, options: ['IN_USE', 'IN_STORAGE', 'UNDER_REPAIR', 'LOST'].map((s) => ({ value: s, label: label(s) })) },
                { name: 'serial', label: 'Serial number', initial: a.serial ?? '' }, { name: 'warrantyEnd', label: 'Warranty ends', type: 'date', initial: a.warrantyEnd ?? '' }, { name: 'notes', label: 'Notes', type: 'textarea', initial: a.notes ?? '' }]} />}
            {maintain && <FormAction label="Service schedule" size="md" url="/api/facilities/assets/schedules" done="Schedule saved" extra={{ assetId: a.id }}
              intro="Recurring service. A reminder is sent before it is due."
              fields={[{ name: 'title', label: 'What is serviced', required: true, placeholder: 'Oil change, fire extinguisher check' }, { name: 'everyMonths', label: 'Every how many months', type: 'number' }, { name: 'everyKm', label: 'Or every how many km (vehicles)', type: 'number' },
                { name: 'remindDaysBefore', label: 'Remind this many days before', type: 'number', initial: '14' }, { name: 'lastDoneAt', label: 'Last done on', type: 'date' }]} />}
            {manage && !pendingDisposal && <FormAction label="Dispose" size="md" variant="danger" url="/api/facilities/assets/disposals" done="Sent for approval" extra={{ assetId: a.id }}
              intro="The Head approves, and the Owner too when the asset cost more than the school's limit. An asset is disposed of only once."
              fields={[{ name: 'method', label: 'How', type: 'select', required: true, options: METHODS.map((m) => ({ value: m, label: label(m) })) }, { name: 'reason', label: 'Reason', type: 'textarea', required: true },
                { name: 'date', label: 'Date', type: 'date' }, { name: 'proceedsCents', label: 'Money received (if sold)', type: 'cents' }, { name: 'currency', label: 'Currency of that money', type: 'select', options: [{ value: 'USD', label: 'US dollars' }, { value: 'ZIG', label: 'ZiG' }] }]} />}
          </div>
        )} />
      <AssetNav can={can} current="/facilities/assets" />
      {disposal && <Notice tone="danger">Disposed of ({label(disposal.method)}) on {disposal.date}: {disposal.reason}{disposal.proceedsCents ? `. Money received ${money(disposal.proceedsCents, disposal.currency ?? 'USD')}.` : ''}</Notice>}
      {pendingDisposal && <Notice tone="warn">A disposal is waiting for approval{pendingDisposal.needsOwner ? ' (the Owner must approve too)' : ''}. <a className="underline" href="/facilities/assets/disposals">See it</a>.</Notice>}
      <Section title="Details">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {([['Status', label(a.status)], ['Condition', label(a.condition)], ['Cost', a.costCents ? money(a.costCents, a.currency) : '—'], ['Book value', a.costCents ? money(a.bookCents, a.currency) : '—'], ['Bought', a.purchasedAt ?? '—'], ['Serial', a.serial ?? '—'], ['Warranty ends', a.warrantyEnd ?? '—'], ['Notes', a.notes ?? '—']] as const).map(([k, v]) => (
            <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-semibold text-ink">{v}</dd></div>
          ))}
        </dl>
      </Section>
      <Section title="Service schedule">
        {schedules.length === 0 ? <p className="text-sm text-muted">No recurring service.</p> : (
          <ul className="flex flex-col gap-2">{schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white p-3 text-sm">
              <span><span className="font-semibold">{s.title}</span> · {s.everyMonths ? `every ${s.everyMonths} months` : ''}{s.everyMonths && s.everyKm ? ' or ' : ''}{s.everyKm ? `every ${s.everyKm} km` : ''} · next {s.nextDueAt ?? `at ${s.nextDueKm} km`}</span>
              {maintain && s.active && <FormAction label="Done" url={`/api/facilities/assets/schedules/${s.id}/done`} done="Service recorded" fields={[{ name: 'workDone', label: 'Work done', required: true, initial: s.title }, { name: 'provider', label: 'Who did it' }, { name: 'costCents', label: 'Cost', type: 'cents' }, { name: 'currency', label: 'Currency', type: 'select', options: [{ value: 'USD', label: 'US dollars' }, { value: 'ZIG', label: 'ZiG' }] }]} />}
            </li>
          ))}</ul>
        )}
      </Section>
      <Section title="Faults and repairs">
        {jobs.length === 0 ? <p className="text-sm text-muted">None.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[30rem]"><thead><tr><Th>Problem</Th><Th>Reported by</Th><Th>Status</Th><Th>Work done</Th><Th className="text-right">Cost</Th></tr></thead><tbody>
            {jobs.map((j) => <tr key={j.id} className="border-t border-line"><Td>{j.problem}</Td><Td>{j.reportedBy}</Td><Td><Badge variant={j.status === 'DONE' ? 'success' : 'warning'} label={label(j.status)} /></Td><Td>{j.workDone ?? '—'}{j.provider ? ` · ${j.provider}` : ''}</Td><Td className="text-right">{j.costCents ? money(j.costCents, j.currency ?? 'USD') : '—'}</Td></tr>)}
          </tbody></table></div>
        )}
      </Section>
      <Section title="Where it has been">
        {transfers.length === 0 ? <p className="text-sm text-muted">Never moved.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[30rem]"><thead><tr><Th>Date</Th><Th>From</Th><Th>To</Th><Th>Recorded by</Th><Th>Confirmed</Th></tr></thead><tbody>
            {transfers.map((t) => <tr key={t.id} className="border-t border-line"><Td>{t.date}</Td><Td>{t.fromLocation}{t.from ? ` · ${t.from}` : ''}</Td><Td>{t.toLocation}{t.to ? ` · ${t.to}` : ''}</Td><Td>{t.recordedBy}</Td><Td>{t.confirmedAt ? t.confirmedAt.slice(0, 10) : <Badge variant="warning" label="Waiting" />}</Td></tr>)}
          </tbody></table></div>
        )}
      </Section>
    </div>
  );
}

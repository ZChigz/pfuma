import Link from 'next/link';
import { getHrAccess as getAccess } from '@/lib/hr/access';
import { listDutyTypes, listRosters, listSwaps } from '@/lib/hr/duties';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { RowAction, Section, Td, Th } from '@/components/finance/shared';
import { HrNav } from '@/components/hr/HrNav';

export const metadata = { title: 'Duty roster · Pfuma' };

export default async function DutiesPage() {
  const { user, can } = await getAccess();
  if (!can('hr.duties.view') && !can('hr.duties.manage') && !can('hr.duties.approve')) return <AccessDenied />;
  const [rosters, types, swaps] = await Promise.all([listRosters(user), listDutyTypes(user), can('hr.duties.manage') ? listSwaps(user) : Promise.resolve([])]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Duty roster" description="The Deputy fills the grid, the Head approves it, and it is published. Staff see their own duties and are reminded the evening before."
        actions={can('hr.duties.manage') && <FormAction label="New roster" variant="primary" size="md" url="/api/hr/duties/rosters" done="Roster started" fields={[{ name: 'label', label: 'Name (for example Term 4 duties)', required: true }, { name: 'startDate', label: 'From', type: 'date', required: true }, { name: 'endDate', label: 'To', type: 'date', required: true }]} />} />
      <HrNav can={can} current="/hr/duties" />
      <Section title="Rosters">
        <table className="w-full"><thead><tr><Th>Roster</Th><Th>Dates</Th><Th>Status</Th></tr></thead><tbody>
          {rosters.map((r) => (<tr key={r.id} className="border-t border-line"><Td><Link className="font-semibold text-primary hover:underline" href={`/hr/duties/${r.id}`}>{r.label}</Link></Td><Td>{r.startDate} to {r.endDate}</Td><Td><Badge variant={r.status === 'PUBLISHED' ? 'success' : r.status === 'APPROVED' ? 'info' : 'neutral'} label={r.status.charAt(0) + r.status.slice(1).toLowerCase()} /></Td></tr>))}
          {rosters.length === 0 && <tr><Td className="text-muted">No rosters yet.</Td></tr>}
        </tbody></table>
      </Section>
      {swaps.length > 0 && (
        <Section title="Swaps waiting" hint="A colleague accepts, then you confirm.">
          <table className="w-full"><thead><tr><Th>Date</Th><Th>From</Th><Th>To</Th><Th>Status</Th><Th /></tr></thead><tbody>
            {swaps.map((s) => (<tr key={s.id} className="border-t border-line"><Td>{s.date}</Td><Td>{s.from}</Td><Td>{s.to}</Td><Td>{s.status === 'ACCEPTED' ? 'Accepted' : 'Asked'}</Td><Td>{s.status === 'ACCEPTED' && <RowAction label="Confirm" variant="primary" url={`/api/hr/duties/swaps/${s.id}/confirm`} done="Swap confirmed" />}</Td></tr>))}
          </tbody></table>
        </Section>
      )}
      <Section title="Duty types" hint="Edit the list in the roster page.">
        <p className="text-sm text-muted">{types.map((t) => t.name).join(' · ')}</p>
        {can('hr.duties.manage') && <div className="mt-2"><FormAction label="Add a duty type" url="/api/hr/duties/types" done="Added" fields={[{ name: 'name', label: 'Name', required: true }, { name: 'perDay', label: 'People needed each day', type: 'number', initial: '1' }, { name: 'wholeDay', label: 'Whole day', type: 'bool' }]} /></div>}
      </Section>
    </div>
  );
}

import { getHrAccess as getAccess } from '@/lib/hr/access';
import { getRoster } from '@/lib/hr/duties';
import { listDirectory } from '@/lib/hr/employees';
import { addDays } from '@/lib/academics/common';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { RowAction, Section, Td, Th } from '@/components/finance/shared';
import { HrNav } from '@/components/hr/HrNav';
import { PrintButton } from '@/components/hr/PrintButton';

export const metadata = { title: 'Duty roster · Pfuma' };
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default async function RosterPage({ params, searchParams }: { params: { id: string }; searchParams: { week?: string } }) {
  const { user, can } = await getAccess();
  let r;
  try { r = await getRoster(user, params.id); } catch (e) { if (e instanceof ServiceError && e.status < 500) return <AccessDenied message={e.status === 404 ? 'This roster does not exist.' : undefined} />; throw e; }
  const start = searchParams.week && searchParams.week >= r.startDate && searchParams.week <= r.endDate ? searchParams.week : r.startDate;
  // Seven days from the chosen start (a roster of a whole term is read a week at a time).
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter((d) => d <= r.endDate);
  const staff = can('hr.duties.manage') && r.status === 'DRAFT' ? (await listDirectory(user, { pageSize: 500 })).items : [];
  const draft = r.status === 'DRAFT', manage = can('hr.duties.manage');
  const prev = addDays(start, -7), next = addDays(start, 7);
  return (
    <div className="flex flex-col gap-4 pb-8 print:gap-2">
      <div className="print:hidden"><PageHeader title={r.label} description={`${r.startDate} to ${r.endDate}`} breadcrumbs={[{ label: 'HR & Staff', href: '/hr' }, { label: 'Duties', href: '/hr/duties' }, { label: r.label }]}
        actions={<div className="flex flex-wrap items-center gap-2"><Badge variant={r.status === 'PUBLISHED' ? 'success' : 'neutral'} label={r.status.charAt(0) + r.status.slice(1).toLowerCase()} /><PrintButton label="Print this week" />
          {manage && draft && <RowAction label="Auto-fill" url={`/api/hr/duties/rosters/${r.id}/auto-fill`} confirm="Fill the empty places evenly across eligible staff? People on approved leave are skipped. Duties already placed stay." done="Roster filled" />}
          {manage && draft && <RowAction label="Import invigilation" url={`/api/hr/duties/rosters/${r.id}/import-invigilation`} done="Imported" />}
          {can('hr.duties.approve') && draft && <RowAction label="Approve" variant="primary" url={`/api/hr/duties/rosters/${r.id}/approve`} confirm="Approve this roster?" done="Approved" />}
          {(can('hr.duties.approve') || manage) && r.status === 'APPROVED' && <RowAction label="Publish" variant="primary" url={`/api/hr/duties/rosters/${r.id}/publish`} confirm="Publish? Staff are told." done="Published" />}</div>} /></div>
      <div className="print:hidden"><HrNav can={can} current="/hr/duties" /></div>
      <div className="hidden print:block"><h1 className="text-xl font-bold">{r.label}: week of {start}</h1></div>
      <Section title="Week" action={<div className="flex gap-2 text-sm print:hidden">{start > r.startDate && <a className="underline" href={`?week=${prev < r.startDate ? r.startDate : prev}`}>Earlier</a>}{next <= r.endDate && <a className="underline" href={`?week=${next}`}>Later</a>}</div>}>
        <div className="overflow-x-auto"><table className="w-full min-w-[40rem] border-collapse">
          <thead><tr><Th>Duty</Th>{days.map((d) => (<Th key={d}>{DAY[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7]} {d.slice(8)}</Th>))}</tr></thead>
          <tbody>
            {r.types.map((t) => (
              <tr key={t.id} className="border-t border-line align-top">
                <Td className="font-semibold">{t.name}</Td>
                {days.map((d) => (
                  <Td key={d}>{r.assignments.filter((a) => a.dutyTypeId === t.id && a.date === d).map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-1">{a.employee}{draft && manage && <span className="print:hidden"><RowAction label="×" variant="ghost" url={`/api/hr/duties/assignments/${a.id}`} method="DELETE" confirm={`Remove ${a.employee} from this duty?`} done="Removed" /></span>}</div>
                  ))}
                    {draft && manage && <div className="print:hidden"><FormAction label="+" size="sm" variant="ghost" title={`${t.name}, ${d}`} url={`/api/hr/duties/rosters/${r.id}/assignments`} extra={{ dutyTypeId: t.id, date: d }} done="Placed" fields={[{ name: 'employeeId', label: 'Who', type: 'select', required: true, options: staff.map((s) => ({ value: s.id, label: s.name })) }]} /></div>}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </table></div>
      </Section>
      <Section title="Duties per person" hint="The most and least loaded are marked. Fairness is over the whole roster.">
        <table className="w-full"><thead><tr><Th>Name</Th><Th className="text-right">Duties</Th><Th /></tr></thead><tbody>
          {r.fairness.map((f) => (<tr key={f.employeeId} className="border-t border-line"><Td>{f.name}</Td><Td className="text-right">{f.count}</Td><Td>{f.most && <Badge variant="warning" label="Most" />}{f.least && <Badge variant="success" label="Least" />}</Td></tr>))}
        </tbody></table>
      </Section>
    </div>
  );
}

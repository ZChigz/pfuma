import { getHrAccess as getAccess } from '@/lib/hr/access';
import { listChangeRequests } from '@/lib/hr/employees';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { RowAction, Section, Td, Th } from '@/components/finance/shared';
import { HrNav } from '@/components/hr/HrNav';

export const metadata = { title: 'Change requests · Pfuma' };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export default async function RequestsPage() {
  const { user, can } = await getAccess();
  if (!can('hr.employees.manage') && !can('hr.pay.manage')) return <AccessDenied />;
  const rows = await listChangeRequests(user);
  const owner = can('hr.pay.manage');
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Change requests" description="Staff ask to change their own details. HR approves; a change of bank or EcoCash details also needs the Owner, and the employee is sent an SMS when it takes effect." />
      <HrNav can={can} current="/hr/requests" />
      <Section title="Requests">
        <div className="overflow-x-auto"><table className="w-full min-w-[40rem]"><thead><tr><Th>Employee</Th><Th>What</Th><Th>Asked for</Th><Th>Status</Th><Th /></tr></thead><tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line align-top">
              <Td>{r.employee}<div className="text-xs text-muted">{r.createdAt.slice(0, 10)}</div></Td><Td>{label(r.group)}</Td>
              <Td className="text-xs">{r.changes ? Object.entries(r.changes as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${String(v)}`).join(' · ') : 'Hidden'}{r.reason && <div className="text-muted">{r.reason}</div>}</Td>
              <Td><Badge variant={r.status === 'APPROVED' ? 'success' : r.status === 'REJECTED' ? 'danger' : 'warning'} label={r.status === 'HR_APPROVED' ? 'Waiting for the Owner' : label(r.status)} /></Td>
              <Td>{(r.status === 'PENDING' || (r.status === 'HR_APPROVED' && owner)) && (
                <div className="flex gap-2"><RowAction label="Approve" variant="primary" url={`/api/hr/changes/${r.id}`} body={{ decision: 'APPROVE' }} done="Approved" />
                  <RowAction label="Reject" variant="danger" url={`/api/hr/changes/${r.id}`} body={{ decision: 'REJECT' }} reason={{ label: 'Why?', min: 3 }} done="Rejected" /></div>)}</Td>
            </tr>
          ))}
          {rows.length === 0 && <tr><Td className="text-muted">No requests.</Td></tr>}
        </tbody></table></div>
      </Section>
    </div>
  );
}

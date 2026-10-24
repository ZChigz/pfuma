import Link from 'next/link';
import { getHrAccess as getAccess } from '@/lib/hr/access';
import { contractsEnding, listContracts } from '@/lib/hr/recruitment';
import { listDirectory } from '@/lib/hr/employees';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { RowAction, Section, Td, Th } from '@/components/finance/shared';
import { HrNav } from '@/components/hr/HrNav';

export const metadata = { title: 'Contracts · Pfuma' };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export default async function ContractsPage() {
  const { user, can } = await getAccess();
  if (!can('hr.contracts.manage')) return <AccessDenied />;
  const [contracts, ending, staff] = await Promise.all([listContracts(user), contractsEnding(user, 90), listDirectory(user, { employer: 'SCHOOL', pageSize: 500 })]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Contracts" description="Every contract carries its own end and review dates. HR and the Head are reminded 60 and 30 days before a contract or a probation ends."
        actions={<FormAction label="New contract" variant="primary" size="md" url="/api/hr/contracts" done="Draft contract made"
          fields={[{ name: 'employeeId', label: 'Employee (school-paid)', type: 'select', required: true, options: staff.items.filter((s) => s.status !== 'RESIGNED').map((s) => ({ value: s.id, label: `${s.name} (${s.employeeNo})` })) },
            { name: 'kind', label: 'Type', type: 'select', required: true, options: [{ value: 'PERMANENT', label: 'Permanent' }, { value: 'FIXED_TERM', label: 'Fixed-term' }, { value: 'TEMPORARY', label: 'Temporary / relief' }, { value: 'CASUAL', label: 'Casual' }] },
            { name: 'jobTitle', label: 'Job title', required: true }, { name: 'startDate', label: 'Start date', type: 'date', required: true }, { name: 'endDate', label: 'End date (fixed-term and temporary)', type: 'date' }, { name: 'probationEnd', label: 'Probation ends', type: 'date' },
            { name: 'hours', label: 'Hours of work' }, { name: 'noticePeriod', label: 'Notice period' }, { name: 'salaryText', label: 'Pay, as it should read in the contract' }]} />} />
      <HrNav can={can} current="/hr/contracts" />
      <Section title="Ending in the next 90 days" hint="Contracts and probations, soonest first.">
        {ending.length === 0 ? <p className="text-sm text-muted">Nothing ends in the next 90 days.</p> : (
          <table className="w-full"><thead><tr><Th>Employee</Th><Th>What</Th><Th>Date</Th><Th className="text-right">Days left</Th></tr></thead><tbody>
            {ending.map((r, i) => (<tr key={i} className="border-t border-line"><Td>{r.employee}</Td><Td>{r.what}</Td><Td>{r.date}</Td><Td className={`text-right ${r.daysLeft <= 30 ? 'text-danger' : ''}`}>{r.daysLeft}</Td></tr>))}
          </tbody></table>
        )}
      </Section>
      <Section title="All contracts">
        <div className="overflow-x-auto"><table className="w-full min-w-[44rem]"><thead><tr><Th>Employee</Th><Th>Type</Th><Th>From</Th><Th>To</Th><Th>Status</Th><Th /></tr></thead><tbody>
          {contracts.map((c) => (
            <tr key={c.id} className="border-t border-line">
              <Td><Link className="text-primary hover:underline" href={`/hr/staff/${c.employeeId}`}>{c.employee}</Link><div className="text-xs text-muted">{c.jobTitle}</div></Td><Td>{label(c.kind)}</Td><Td>{c.startDate}</Td><Td>{c.endDate ?? 'Open'}</Td>
              <Td><Badge variant={c.status === 'ACTIVE' ? 'success' : c.status === 'DRAFT' ? 'warning' : 'neutral'} label={label(c.status)} />{c.signed && <span className="ml-1 text-xs text-muted">signed</span>}</Td>
              <Td><div className="flex flex-wrap gap-2">
                {c.status === 'DRAFT' && <RowAction label="Activate" variant="primary" url={`/api/hr/contracts/${c.id}/activate`} confirm="Activate this contract? The contract document is made from the template." done="Contract active" />}
                {['ACTIVE', 'EXPIRED'].includes(c.status) && <FormAction label="Renew" url={`/api/hr/contracts/${c.id}/renew`} done="Renewal drafted" fields={[{ name: 'endDate', label: 'New end date', type: 'date' }, { name: 'kind', label: 'Type', type: 'select', options: [{ value: 'PERMANENT', label: 'Permanent' }, { value: 'FIXED_TERM', label: 'Fixed-term' }, { value: 'TEMPORARY', label: 'Temporary / relief' }, { value: 'CASUAL', label: 'Casual' }] }]} />}
                {c.documentId && <Link className="self-center text-sm text-primary underline" href={`/hr/letters/${c.documentId}`}>Open / print</Link>}
                {c.status === 'ACTIVE' && !c.signed && <FormAction label="Signed copy" url={`/api/hr/contracts/${c.id}/signed`} done="Attached" fields={[{ name: 'signedFileKey', label: 'Signed copy', type: 'file', required: true }]} />}
              </div></Td>
            </tr>
          ))}
          {contracts.length === 0 && <tr><Td className="text-muted">No contracts yet.</Td></tr>}
        </tbody></table></div>
      </Section>
    </div>
  );
}

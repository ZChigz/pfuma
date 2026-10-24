import Link from 'next/link';
import { getHrAccess as getAccess } from '@/lib/hr/access';
import { listDirectory } from '@/lib/hr/employees';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Pager, fieldClass } from '@/components/finance/format';
import { Section, Td, Th } from '@/components/finance/shared';
import { HrNav } from '@/components/hr/HrNav';

export const metadata = { title: 'Staff · Pfuma' };

const CATS = ['TEACHING', 'ADMINISTRATION', 'ANCILLARY', 'BOARDING', 'SECURITY', 'GROUNDS'];
const STATUSES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED'];
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export default async function StaffDirectory({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const { user, can } = await getAccess();
  if (!can('hr.directory.view') && !can('hr.employees.view')) return <AccessDenied />;
  const d = await listDirectory(user, searchParams);
  const qs = new URLSearchParams(Object.entries(searchParams).filter(([k, v]) => v && k !== 'page') as [string, string][]);
  const manage = can('hr.employees.manage');
  const deptOptions = d.departments.map((x) => ({ value: x.id, label: x.name }));
  const catOptions = CATS.map((c) => ({ value: c, label: label(c) }));
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Staff" description="Everyone who works at the school: teachers paid by the government and staff paid by the school."
        actions={manage && (
          <div className="flex flex-wrap gap-2">
            <FormAction label="Add government teacher" variant="secondary" size="md" url="/api/hr/government-teachers" done="Teacher added" intro="A teacher posted by the ministry. No vacancy is needed."
              fields={[{ name: 'firstName', label: 'First name', required: true }, { name: 'surname', label: 'Surname', required: true }, { name: 'ecNumber', label: 'EC number', required: true }, { name: 'postedOn', label: 'Posting date', type: 'date', required: true },
                { name: 'gender', label: 'Gender', type: 'select', options: [{ value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }] }, { name: 'departmentId', label: 'Department', type: 'select', options: deptOptions }, { name: 'workPhone', label: 'Work phone' }]} />
            <FormAction label="Add staff member" variant="primary" size="md" url="/api/hr/employees" done="Staff member added"
              fields={[{ name: 'firstName', label: 'First name', required: true }, { name: 'surname', label: 'Surname', required: true }, { name: 'jobTitle', label: 'Job title', required: true },
                { name: 'category', label: 'Category', type: 'select', required: true, options: catOptions },
                { name: 'employer', label: 'Paid by', type: 'select', required: true, options: [{ value: 'SCHOOL', label: 'The school' }, { value: 'GOVERNMENT', label: 'The government' }] },
                { name: 'ecNumber', label: 'EC number (government-paid only)' }, { name: 'startDate', label: 'Start date', type: 'date', required: true },
                { name: 'departmentId', label: 'Department', type: 'select', options: deptOptions }, { name: 'gender', label: 'Gender', type: 'select', options: [{ value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }] }, { name: 'workPhone', label: 'Work phone' }]} />
          </div>
        )} />
      <HrNav can={can} current="/hr/staff" />
      <form className="grid grid-cols-2 gap-2 rounded-2xl bg-white p-3 md:grid-cols-4 lg:grid-cols-7" method="get">
        <input name="q" defaultValue={searchParams.q} placeholder="Search name, number, title" aria-label="Search" className={`${fieldClass} col-span-2`} />
        <select name="departmentId" defaultValue={searchParams.departmentId ?? ''} aria-label="Department" className={fieldClass}><option value="">All departments</option>{d.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select name="category" defaultValue={searchParams.category ?? ''} aria-label="Category" className={fieldClass}><option value="">All categories</option>{CATS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select>
        <select name="employer" defaultValue={searchParams.employer ?? ''} aria-label="Paid by" className={fieldClass}><option value="">Government and school</option><option value="GOVERNMENT">Government-paid</option><option value="SCHOOL">School-paid</option></select>
        <select name="status" defaultValue={searchParams.status ?? ''} aria-label="Status" className={fieldClass}><option value="">Any status</option>{STATUSES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select>
        {can('hr.employees.view') && <select name="gender" defaultValue={searchParams.gender ?? ''} aria-label="Gender" className={fieldClass}><option value="">Any gender</option><option value="M">Male</option><option value="F">Female</option></select>}
        <button className="h-11 rounded-full bg-primary px-5 text-sm font-semibold text-white">Filter</button>
      </form>
      <Section title={`${d.total} staff`} action={<a className="text-sm underline" href={`/api/hr/employees/export?${qs.toString()}`}>Export (CSV)</a>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem]">
            <thead><tr><Th>Name</Th><Th>Job title</Th><Th>Department</Th><Th>Category</Th><Th>Paid by</Th><Th>Status</Th><Th>Phone</Th></tr></thead>
            <tbody>
              {d.items.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <Td><Link className="font-semibold text-primary hover:underline" href={`/hr/staff/${r.id}`}>{r.name}</Link><div className="text-xs text-muted">{r.employeeNo}</div></Td>
                  <Td>{r.jobTitle}</Td><Td>{r.department ?? '—'}</Td><Td>{label(r.category)}</Td>
                  <Td><Badge variant={r.employer === 'GOVERNMENT' ? 'info' : 'neutral'} label={r.employer === 'GOVERNMENT' ? 'Government' : 'School'} /></Td>
                  <Td><Badge variant={r.status === 'ACTIVE' ? 'success' : r.status === 'ON_LEAVE' || r.status === 'SUSPENDED' ? 'warning' : 'neutral'} label={label(r.status)} /></Td>
                  <Td>{r.phone ?? '—'}</Td>
                </tr>
              ))}
              {d.items.length === 0 && <tr><Td className="text-muted">Nobody matches.</Td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={d.page} pageSize={d.pageSize} total={d.total} hrefFor={(p) => `/hr/staff?${new URLSearchParams([...Array.from(qs.entries()), ['page', String(p)]]).toString()}`} />
      </Section>
    </div>
  );
}

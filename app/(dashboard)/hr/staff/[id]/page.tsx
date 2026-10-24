import Link from 'next/link';
import { getHrAccess as getAccess } from '@/lib/hr/access';
import { getEmployee, listPayComponents, listUnlinkedUsers } from '@/lib/hr/employees';
import { listDiscipline } from '@/lib/hr/discipline';
import { listContracts } from '@/lib/hr/recruitment';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Money } from '@/components/finance/format';
import { Notice, RowAction, Section, Td, Th } from '@/components/finance/shared';
import { HrNav, LinkTabs } from '@/components/hr/HrNav';

export const metadata = { title: 'Staff record · Pfuma' };

const label = (s: string | null | undefined) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '—');
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (<div className="flex flex-col gap-0.5 border-b border-line py-2 sm:flex-row sm:gap-4"><dt className="w-48 flex-shrink-0 text-sm text-muted">{k}</dt><dd className="text-sm text-ink">{v || '—'}</dd></div>);

export default async function EmployeePage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string } }) {
  const { user, can } = await getAccess();
  let e;
  try { e = await getEmployee(user, params.id); } catch (err) {
    if (err instanceof ServiceError && err.status === 403) return <AccessDenied />;
    if (err instanceof ServiceError && err.status === 404) return <AccessDenied message="This staff record does not exist." />;
    throw err;
  }
  const full = e.access.full, pay = e.access.pay;
  const manage = can('hr.employees.manage'), payManage = can('hr.pay.manage');
  const tabs = full
    ? [{ id: 'personal', label: 'Personal' }, { id: 'employment', label: 'Employment' }, ...(e.employer === 'SCHOOL' && pay ? [{ id: 'pay', label: 'Pay' }] : []), { id: 'qualifications', label: 'Qualifications' }, { id: 'kin', label: 'Next of kin' }, { id: 'documents', label: 'Documents' }, { id: 'history', label: 'History' }, ...(can('hr.discipline.view') ? [{ id: 'discipline', label: 'Discipline' }] : [])]
    : [{ id: 'employment', label: 'Employment' }];
  const tab = tabs.some((t) => t.id === searchParams.tab) ? searchParams.tab! : tabs[0]!.id;
  const base = `/hr/staff/${e.id}`;
  const contracts = tab === 'employment' && can('hr.contracts.manage') ? await listContracts(user, e.id) : [];
  const disc = tab === 'discipline' && can('hr.discipline.view') ? await listDiscipline(user, e.id) : [];
  const comps = tab === 'pay' && payManage ? await listPayComponents(user) : [];
  const unlinked = tab === 'employment' && manage && !e.userId ? await listUnlinkedUsers(user) : [];
  const p = e.pay as null | { components: { id: string; name: string; kind: string; amountCents: number; currency: 'USD' | 'ZIG'; startsOn: string; endsOn: string | null; active: boolean }[]; loans: { id: string; principalCents: number; balanceCents: number; instalmentCents: number; currency: 'USD' | 'ZIG'; status: string; startMonth: string }[]; [k: string]: unknown };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title={e.name} description={`${e.employeeNo} · ${e.jobTitle}${e.department ? ` · ${e.department}` : ''}`} breadcrumbs={[{ label: 'HR & Staff', href: '/hr' }, { label: 'Staff', href: '/hr/staff' }, { label: e.name }]}
        actions={<div className="flex flex-wrap items-center gap-2"><Badge variant={e.employer === 'GOVERNMENT' ? 'info' : 'neutral'} label={e.employer === 'GOVERNMENT' ? 'Government-paid' : 'School-paid'} /><Badge variant={e.status === 'ACTIVE' ? 'success' : 'warning'} label={label(e.status)} /></div>} />
      <HrNav can={can} current="/hr/staff" />
      {!full && <Notice tone="info">You can see names, titles, departments and the work phone. The full record is for HR and the Owner.</Notice>}
      <LinkTabs base={base} current={tab} tabs={tabs} />

      {tab === 'personal' && e.personal && (
        <Section title="Personal" action={manage && <FormAction label="Change" url={`/api/hr/employees/${e.id}`} method="PATCH" done="Saved" title="Personal details" intro="Leave a box empty to keep it as it is."
          fields={[{ name: 'homeAddress', label: 'Home address' }, { name: 'personalPhone', label: 'Personal phone' }, { name: 'personalEmail', label: 'Personal email' }, { name: 'maritalStatus', label: 'Marital status' }, { name: 'nationality', label: 'Nationality' }, { name: 'workPhone', label: 'Work phone' }, ...(pay ? [{ name: 'nationalId', label: 'National ID number' }, { name: 'medicalNotes', label: 'Medical notes', type: 'textarea' as const }] : [])]} />}>
          <dl>
            <Row k="Title and name" v={e.name} /><Row k="Gender" v={e.personal.gender === 'M' ? 'Male' : e.personal.gender === 'F' ? 'Female' : ''} /><Row k="Date of birth" v={e.personal.dateOfBirth} />
            <Row k="National ID" v={pay ? e.personal.nationalId : 'Hidden'} /><Row k="Nationality" v={e.personal.nationality} /><Row k="Marital status" v={e.personal.maritalStatus} />
            <Row k="Home address" v={e.personal.homeAddress} /><Row k="Personal phone" v={e.personal.personalPhone} /><Row k="Personal email" v={e.personal.personalEmail} /><Row k="Work phone" v={e.workPhone} />
            {pay && <Row k="Medical notes" v={e.personal.medicalNotes} />}
          </dl>
        </Section>
      )}

      {tab === 'employment' && (
        <>
          <Section title="Employment" action={manage && full && (
            <div className="flex flex-wrap gap-2">
              <FormAction label="Change" url={`/api/hr/employees/${e.id}`} method="PATCH" done="Saved" title="Employment details" intro="Changing who pays a person needs a reason. Position changes are kept in the history."
                fields={[{ name: 'jobTitle', label: 'Job title', initial: e.jobTitle }, { name: 'employer', label: 'Paid by', type: 'select', options: [{ value: 'SCHOOL', label: 'The school' }, { value: 'GOVERNMENT', label: 'The government' }], initial: e.employer }, { name: 'ecNumber', label: 'EC number (government-paid only)', initial: e.employment?.ecNumber ?? '' }, { name: 'reason', label: 'Reason for the change', type: 'textarea' }]} />
              <FormAction label="Status" url={`/api/hr/employees/${e.id}/status`} done="Status changed" title="Change status" intro="Active, on leave or suspended. A person who leaves goes through End employment."
                fields={[{ name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'ON_LEAVE', label: 'On leave' }, { value: 'SUSPENDED', label: 'Suspended' }] }, { name: 'reason', label: 'Reason', required: true }]} />
              {!e.userId && <FormAction label="Link login" url={`/api/hr/employees/${e.id}/link-user`} done="Linked" fields={[{ name: 'userId', label: 'Login', type: 'select', required: true, options: unlinked.map((u) => ({ value: u.id, label: `${u.fullName} (${u.email})` })) }]} />}
              {e.employer === 'SCHOOL' && <FormAction label="Tablet PIN" url={`/api/hr/employees/${e.id}/tablet-pin`} done="PIN set" intro="For the shared office tablet, for staff without a phone." fields={[{ name: 'pin', label: '4-digit PIN', required: true, maxLength: 4 }]} />}
              {can('hr.contracts.manage') && !['RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED'].includes(e.status) && (
                <FormAction label="End employment" variant="danger" url={`/api/hr/employees/${e.id}/end-employment`} done="Employment ended" title="End employment" intro="The record and its history are kept. The login is switched off and a certificate of service is made."
                  fields={[{ name: 'reason', label: 'Reason', type: 'select', required: true, options: [{ value: 'RESIGNATION', label: 'Resignation' }, { value: 'END_OF_CONTRACT', label: 'End of contract' }, { value: 'RETIREMENT', label: 'Retirement' }, { value: 'DISMISSAL', label: 'Dismissal' }, { value: 'DEATH', label: 'Death' }] }, { name: 'lastDay', label: 'Last day', type: 'date', required: true }, { name: 'noticeServed', label: 'Notice served', type: 'bool' }]} />
              )}
            </div>
          )}>
            <dl>
              <Row k="Employee number" v={e.employeeNo} /><Row k="Job title" v={e.jobTitle} /><Row k="Department" v={e.department} /><Row k="Category" v={label(e.category)} /><Row k="Paid by" v={e.employer === 'GOVERNMENT' ? 'The government' : 'The school'} />
              {full && e.employment && <><Row k="EC number" v={e.employment.ecNumber} /><Row k="Posted on" v={e.employment.postedOn} /><Row k="Start date" v={e.employment.startDate} /><Row k="Line manager" v={e.lineManager?.name} /><Row k="Login" v={e.userId ? 'Linked' : 'None'} />
                {e.employment.leavingDate && <Row k="Left" v={`${e.employment.leavingDate} (${label(e.employment.leavingReason)})`} />}</>}
            </dl>
          </Section>
          {contracts.length > 0 && (
            <Section title="Contracts">
              <table className="w-full"><thead><tr><Th>Type</Th><Th>From</Th><Th>To</Th><Th>Status</Th></tr></thead><tbody>
                {contracts.map((c) => (<tr key={c.id} className="border-t border-line"><Td>{label(c.kind)}</Td><Td>{c.startDate}</Td><Td>{c.endDate ?? 'Open'}</Td><Td>{label(c.status)}</Td></tr>))}
              </tbody></table>
            </Section>
          )}
        </>
      )}

      {tab === 'pay' && p && (
        <>
          <Section title="Pay" hint="Only HR and the Owner see this. Every look is logged." action={payManage && (
            <FormAction label="Change pay" url={`/api/hr/employees/${e.id}/pay`} method="PUT" done="Pay saved" title="Pay and payment details" intro="A reason is needed. Before and after values go to the history."
              fields={[
                { name: 'paymentMethod', label: 'Payment method', type: 'select', required: true, initial: String(p.paymentMethod), options: [{ value: 'BANK', label: 'Bank' }, { value: 'ECOCASH', label: 'EcoCash' }, { value: 'CASH', label: 'Cash' }] },
                { name: 'bankName', label: 'Bank', initial: String(p.bankName ?? '') }, { name: 'accountNumber', label: 'Account number', initial: String(p.accountNumber ?? '') }, { name: 'ecocashNumber', label: 'EcoCash number', initial: String(p.ecocashNumber ?? '') },
                { name: 'basicUsdCents', label: 'Basic pay (US$)', type: 'cents', initial: String(Number(p.basicUsdCents ?? 0) / 100) }, { name: 'basicZigCents', label: 'Basic pay (ZiG)', type: 'cents', initial: String(Number(p.basicZigCents ?? 0) / 100) },
                { name: 'zimraTaxNo', label: 'ZIMRA tax number', initial: String(p.zimraTaxNo ?? '') }, { name: 'nssaNo', label: 'NSSA number', initial: String(p.nssaNo ?? '') },
                { name: 'medicalAidNo', label: 'Medical aid number', initial: String(p.medicalAidNo ?? '') }, { name: 'pensionNo', label: 'Pension number', initial: String(p.pensionNo ?? '') }, { name: 'reason', label: 'Reason for the change', type: 'textarea', required: true }]} />
          )}>
            <dl>
              <Row k="Basic pay" v={<span className="flex gap-3"><Money cents={Number(p.basicUsdCents ?? 0)} currency="USD" /><Money cents={Number(p.basicZigCents ?? 0)} currency="ZIG" /></span>} />
              <Row k="Payment" v={`${label(String(p.paymentMethod))}${p.bankName ? ` · ${p.bankName} ${p.accountNumber ?? ''}` : ''}${p.ecocashNumber ? ` · ${p.ecocashNumber}` : ''}`} />
              <Row k="ZIMRA tax number" v={String(p.zimraTaxNo ?? '')} /><Row k="NSSA number" v={String(p.nssaNo ?? '')} /><Row k="Medical aid" v={String(p.medicalAidNo ?? '')} /><Row k="Pension" v={String(p.pensionNo ?? '')} />
            </dl>
          </Section>
          <Section title="Allowances and deductions" action={payManage && <FormAction label="Add" url={`/api/hr/employees/${e.id}/components`} done="Saved" fields={[{ name: 'componentId', label: 'Allowance or deduction', type: 'select', required: true, options: comps.map((c) => ({ value: c.id, label: `${c.name} (${c.kind === 'ALLOWANCE' ? 'allowance' : 'deduction'})` })) }, { name: 'amountCents', label: 'Amount', type: 'cents', required: true }, { name: 'currency', label: 'Currency', type: 'select', options: [{ value: 'USD', label: 'US dollars' }, { value: 'ZIG', label: 'ZiG' }] }, { name: 'startsOn', label: 'From', type: 'date', required: true }, { name: 'reason', label: 'Reason', required: true }]} />}>
            <table className="w-full"><thead><tr><Th>Item</Th><Th className="text-right">Amount</Th><Th>From</Th><Th>To</Th><Th /></tr></thead><tbody>
              {p.components.map((c) => (<tr key={c.id} className="border-t border-line"><Td>{c.name}</Td><Td className="text-right"><Money cents={c.amountCents} currency={c.currency} /></Td><Td>{c.startsOn}</Td><Td>{c.endsOn ?? 'Open'}</Td>
                <Td>{c.active && payManage && <RowAction label="End" url={`/api/hr/components/${c.id}/end`} fields={[{ name: 'endsOn', label: 'Last day (YYYY-MM-DD)' }]} reason={{ label: 'Reason', min: 5 }} done="Ended" />}</Td></tr>))}
              {p.components.length === 0 && <tr><Td className="text-muted">None.</Td></tr>}
            </tbody></table>
          </Section>
          <Section title="Loans and advances" action={payManage && <FormAction label="Add loan" url="/api/hr/loans" extra={{ employeeId: e.id }} done="Loan recorded" fields={[{ name: 'principalCents', label: 'Amount lent', type: 'cents', required: true }, { name: 'instalmentCents', label: 'Monthly instalment', type: 'cents', required: true }, { name: 'startMonth', label: 'First month (YYYY-MM)', required: true }, { name: 'reason', label: 'Reason', required: true }]} />}>
            <table className="w-full"><thead><tr><Th>Lent</Th><Th className="text-right">Balance</Th><Th className="text-right">Instalment</Th><Th>Status</Th></tr></thead><tbody>
              {p.loans.map((l) => (<tr key={l.id} className="border-t border-line"><Td><Money cents={l.principalCents} currency={l.currency} /> from {l.startMonth}</Td><Td className="text-right"><Money cents={l.balanceCents} currency={l.currency} /></Td><Td className="text-right"><Money cents={l.instalmentCents} currency={l.currency} /></Td><Td>{label(l.status)}</Td></tr>))}
              {p.loans.length === 0 && <tr><Td className="text-muted">None.</Td></tr>}
            </tbody></table>
          </Section>
        </>
      )}
      {tab === 'pay' && !p && e.employer === 'SCHOOL' && payManage && (
        <Section title="Pay"><p className="mb-2 text-sm text-muted">No pay has been set up yet.</p>
          <FormAction label="Set up pay" variant="primary" url={`/api/hr/employees/${e.id}/pay`} method="PUT" done="Pay saved" fields={[{ name: 'paymentMethod', label: 'Payment method', type: 'select', required: true, options: [{ value: 'BANK', label: 'Bank' }, { value: 'ECOCASH', label: 'EcoCash' }, { value: 'CASH', label: 'Cash' }] }, { name: 'bankName', label: 'Bank' }, { name: 'accountNumber', label: 'Account number' }, { name: 'ecocashNumber', label: 'EcoCash number' }, { name: 'basicUsdCents', label: 'Basic pay (US$)', type: 'cents' }, { name: 'basicZigCents', label: 'Basic pay (ZiG)', type: 'cents' }, { name: 'reason', label: 'Reason', required: true, initial: 'Initial set-up' }]} />
        </Section>
      )}

      {tab === 'qualifications' && (
        <Section title="Qualifications, teaching subjects and registration" action={manage && <FormAction label="Add" url={`/api/hr/employees/${e.id}/qualifications`} done="Added" fields={[{ name: 'kind', label: 'Kind', type: 'select', required: true, options: [{ value: 'QUALIFICATION', label: 'Qualification' }, { value: 'SUBJECT', label: 'Subject they can teach' }, { value: 'REGISTRATION', label: 'Professional registration' }] }, { name: 'title', label: 'Title', required: true }, { name: 'institution', label: 'Institution' }, { name: 'year', label: 'Year', type: 'number' }]} />}>
          <ul className="divide-y divide-line">{e.qualifications.map((q) => <li key={q.id} className="py-2 text-sm"><b>{q.title}</b> <span className="text-muted">· {label(q.kind)}{q.institution ? ` · ${q.institution}` : ''}{q.year ? ` · ${q.year}` : ''}</span></li>)}{e.qualifications.length === 0 && <li className="py-2 text-sm text-muted">None recorded.</li>}</ul>
        </Section>
      )}

      {tab === 'kin' && (
        <Section title="Next of kin" action={manage && <FormAction label="Add" url={`/api/hr/employees/${e.id}/next-of-kin`} done="Added" fields={[{ name: 'name', label: 'Name', required: true }, { name: 'relationship', label: 'Relationship', required: true }, { name: 'phone', label: 'Phone', required: true }, { name: 'address', label: 'Address' }, { name: 'isEmergency', label: 'Emergency contact', type: 'bool' }]} />}>
          <ul className="divide-y divide-line">{e.nextOfKin.map((k) => <li key={k.id} className="py-2 text-sm"><b>{k.name}</b> · {k.relationship} · {k.phone}{k.isEmergency && <span className="ml-2"><Badge variant="warning" label="Emergency contact" /></span>}</li>)}{e.nextOfKin.length === 0 && <li className="py-2 text-sm text-muted">None recorded.</li>}</ul>
        </Section>
      )}

      {tab === 'documents' && (
        <Section title="Documents" hint="Contracts, letters and certificates. Every letter has a reference number." action={can('hr.documents.manage') && (
          <div className="flex flex-wrap gap-2">
            <FormAction label="Make a letter" url={`/api/hr/employees/${e.id}/letters`} done="Letter saved" intro="The letter is filled in from the template and saved here with a reference number."
              fields={[{ name: 'template', label: 'Letter', type: 'select', required: true, options: [{ value: 'APPOINTMENT', label: 'Appointment letter' }, { value: 'CONFIRMATION', label: 'Confirmation after probation' }, { value: 'SALARY_CHANGE', label: 'Salary change' }, { value: 'WARNING', label: 'Warning letter' }, { value: 'SUSPENSION', label: 'Suspension' }, { value: 'CERTIFICATE_OF_SERVICE', label: 'Certificate of service' }, { value: 'CONFIRMATION_OF_EMPLOYMENT', label: 'Confirmation of employment' }, { value: 'RECOMMENDATION', label: 'Recommendation' }, { value: 'LEAVING', label: 'Leaving letter' }] }]} />
            <FormAction label="Add a document" url={`/api/hr/employees/${e.id}/documents`} done="Added" fields={[{ name: 'kind', label: 'Kind', type: 'select', required: true, options: [{ value: 'ID_COPY', label: 'ID copy' }, { value: 'CERTIFICATE', label: 'Certificate' }, { value: 'CONTRACT', label: 'Contract' }, { value: 'APPOINTMENT_LETTER', label: 'Appointment letter' }, { value: 'OTHER', label: 'Other' }] }, { name: 'title', label: 'Title', required: true }, { name: 'fileKey', label: 'File', type: 'file' }, { name: 'expiresOn', label: 'Expires', type: 'date' }]} />
          </div>
        )}>
          <ul className="divide-y divide-line">{e.documents.map((d) => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span><b>{d.title}</b> <span className="text-muted">· {label(d.kind)}{d.reference ? ` · ${d.reference}` : ''}{d.expiresOn ? ` · expires ${d.expiresOn}` : ''}</span></span>{d.body && <Link className="text-primary underline" href={`/hr/letters/${d.id}`}>Open / print</Link>}</li>)}{e.documents.length === 0 && <li className="py-2 text-sm text-muted">None.</li>}</ul>
        </Section>
      )}

      {tab === 'history' && (
        <Section title="History" hint="Position, pay and status changes with dates and who made them.">
          <div className="overflow-x-auto"><table className="w-full min-w-[34rem]"><thead><tr><Th>Date</Th><Th>What</Th><Th>From</Th><Th>To</Th><Th>Reason</Th></tr></thead><tbody>
            {e.history.map((h) => (<tr key={h.id} className="border-t border-line"><Td>{h.effectiveDate}</Td><Td>{h.field.replace('pay.', 'pay: ')}</Td><Td>{h.oldValue ?? '—'}</Td><Td>{h.newValue ?? '—'}</Td><Td>{h.reason ?? ''}</Td></tr>))}
          </tbody></table></div>
        </Section>
      )}

      {tab === 'discipline' && (
        <Section title="Disciplinary records" hint="Visible only to HR, the Head and the Owner." action={can('hr.discipline.manage') && <FormAction label="Record a case" url="/api/hr/discipline" extra={{ employeeId: e.id }} done="Recorded" fields={[{ name: 'category', label: 'Category', required: true }, { name: 'description', label: 'What happened', type: 'textarea', required: true }, { name: 'incidentDate', label: 'Date', type: 'date', required: true }, { name: 'hearingDate', label: 'Hearing date', type: 'date' }, { name: 'panel', label: 'Panel' }, { name: 'outcome', label: 'Outcome', type: 'select', options: [{ value: 'VERBAL_WARNING', label: 'Verbal warning' }, { value: 'WRITTEN_WARNING', label: 'Written warning' }, { value: 'FINAL_WARNING', label: 'Final warning' }, { value: 'SUSPENSION', label: 'Suspension' }, { value: 'DISMISSAL', label: 'Dismissal' }, { value: 'NO_ACTION', label: 'No action' }] }]} />}>
          <ul className="divide-y divide-line">{disc.map((d) => <li key={d.id} className="py-2 text-sm"><b>{d.category}</b> · {d.incidentDate}{d.outcome ? ` · ${label(d.outcome)}` : ''}<p className="text-muted">{d.description}</p></li>)}{disc.length === 0 && <li className="py-2 text-sm text-muted">None.</li>}</ul>
        </Section>
      )}
    </div>
  );
}

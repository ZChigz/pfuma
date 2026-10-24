import { getHrAccess as getAccess } from '@/lib/hr/access';
import { listApplicants, listPosts, listVacancies } from '@/lib/hr/recruitment';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { RowAction, Section, Td, Th } from '@/components/finance/shared';
import { HrNav } from '@/components/hr/HrNav';
import { ScoreForm } from '@/components/hr/ScoreForm';

export const metadata = { title: 'Recruitment · Pfuma' };

const NEXT: Record<string, string> = { APPLIED: 'SHORTLISTED', SHORTLISTED: 'INTERVIEWED', INTERVIEWED: 'OFFERED' };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export default async function RecruitmentPage() {
  const { user, can } = await getAccess();
  if (!can('hr.recruitment.manage')) return <AccessDenied />;
  const [vacancies, posts] = await Promise.all([listVacancies(user), listPosts(user)]);
  const open = vacancies.filter((v) => v.status === 'OPEN');
  const applicants = Object.fromEntries(await Promise.all(open.map(async (v) => [v.id, await listApplicants(user, v.id)] as const)));
  const offerable = posts.filter((p) => p.status === 'APPROVED' && p.employer === 'SCHOOL' && p.vacant > p.openVacancies);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Recruitment" description="Open a vacancy on an approved post, record the applicants and the interview panel's scores, and hire. Government teachers are added directly under Staff."
        actions={<FormAction label="Open a vacancy" variant="primary" size="md" url="/api/hr/vacancies" done="Vacancy opened"
          fields={[{ name: 'postId', label: 'Post', type: 'select', required: true, options: offerable.map((p) => ({ value: p.id, label: `${p.title} (${p.vacant} vacant)` })) }, { name: 'title', label: 'Advert title', required: true }, { name: 'requirements', label: 'Requirements', type: 'textarea' }, { name: 'closingDate', label: 'Closing date', type: 'date', required: true }]} />} />
      <HrNav can={can} current="/hr/recruitment" />
      {vacancies.length === 0 && <Section title="Vacancies"><p className="text-sm text-muted">No vacancies yet. Posts must be approved by the Head and the Owner first.</p></Section>}
      {vacancies.map((v) => (
        <Section key={v.id} title={v.title} hint={`Closes ${v.closingDate}. ${v.requirements ?? ''}`}
          action={<div className="flex items-center gap-2"><Badge variant={v.status === 'OPEN' ? 'success' : 'neutral'} label={label(v.status)} />
            {v.status === 'OPEN' && <FormAction label="Add applicant" url="/api/hr/applicants" extra={{ vacancyId: v.id }} done="Applicant added" fields={[{ name: 'name', label: 'Full name', required: true }, { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email' }, { name: 'cvKey', label: 'CV', type: 'file' }, { name: 'qualifications', label: 'Qualifications', type: 'textarea' }, { name: 'notes', label: 'Notes', type: 'textarea' }]} />}
            {v.status === 'OPEN' && <RowAction label="Close" url={`/api/hr/vacancies/${v.id}/close`} confirm="Close this vacancy?" done="Closed" />}</div>}>
          {(applicants[v.id] ?? []).length === 0 ? <p className="text-sm text-muted">No applicants yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[40rem]"><thead><tr><Th>Applicant</Th><Th>Stage</Th><Th className="text-right">Panel average (1–5)</Th><Th>Recommendations</Th><Th /></tr></thead><tbody>
              {applicants[v.id]!.map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <Td>{a.name}<div className="text-xs text-muted">{[a.phone, a.email].filter(Boolean).join(' · ')}</div></Td><Td>{label(a.stage)}</Td>
                  <Td className="text-right">{a.average ?? '—'} <span className="text-xs text-muted">({a.panelists})</span></Td><Td>{a.recommendations.map((r) => r.replace('_', ' ').toLowerCase()).join(', ') || '—'}</Td>
                  <Td><div className="flex flex-wrap gap-2">
                    {NEXT[a.stage] && <RowAction label={`Move to ${label(NEXT[a.stage]!)}`} url={`/api/hr/applicants/${a.id}/stage`} body={{ stage: NEXT[a.stage] }} done="Moved" />}
                    {['SHORTLISTED', 'INTERVIEWED'].includes(a.stage) && <ScoreForm applicantId={a.id} name={a.name} />}
                    {a.stage === 'OFFERED' && <FormAction label="Hire" variant="primary" url={`/api/hr/applicants/${a.id}/hire`} done="Hired. A draft contract was made." fields={[{ name: 'startDate', label: 'Start date', type: 'date', required: true }, { name: 'kind', label: 'Contract', type: 'select', required: true, options: [{ value: 'PERMANENT', label: 'Permanent' }, { value: 'FIXED_TERM', label: 'Fixed-term' }, { value: 'TEMPORARY', label: 'Temporary / relief' }, { value: 'CASUAL', label: 'Casual' }] }, { name: 'endDate', label: 'End date (fixed-term and temporary)', type: 'date' }, { name: 'probationEnd', label: 'Probation ends', type: 'date' }]} />}
                    {!['HIRED', 'REJECTED'].includes(a.stage) && <RowAction label="Reject" variant="danger" url={`/api/hr/applicants/${a.id}/stage`} body={{ stage: 'REJECTED' }} reason={{ label: 'Why?', min: 3 }} done="Rejected" />}
                  </div></Td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </Section>
      ))}
    </div>
  );
}

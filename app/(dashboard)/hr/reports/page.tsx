import Link from 'next/link';
import { getHrAccess as getAccess } from '@/lib/hr/access';
import { HR_REPORT_SLUGS, HR_REPORT_TITLES } from '@/lib/hr/reports';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section } from '@/components/finance/shared';
import { HrNav } from '@/components/hr/HrNav';

export const metadata = { title: 'HR reports · Pfuma' };

const ABOUT: Record<string, string> = {
  headcount: 'Staff by department, category, who pays them, gender and age band.', establishment: 'Posts approved, filled and vacant.', 'contracts-ending': 'Contracts and probations ending in the next 90 days.',
  qualifications: 'Teachers by qualification and the subjects they can teach.', leave: 'Leave taken, and who is away this week.', attendance: 'Attendance rate and lateness by employee.', duties: 'Duties per person this term.',
  'payroll-summary': 'Gross, deductions and net per month, department and currency.', statutory: 'PAYE with AIDS levy, NSSA and ZIMDEF per month, with what is due and paid.', 'wage-bill': 'Total staff cost per month, this year against last year.',
  'staff-returns': 'The staff list in the format the district or ministry asks for (you choose the columns).',
};

export default async function ReportsPage() {
  const { can } = await getAccess();
  if (!can('hr.reports.view') && !can('hr.payroll.view')) return <AccessDenied />;
  const pay = ['payroll-summary', 'statutory', 'wage-bill'];
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="HR reports" description="Filter on screen, then download as Excel, CSV or PDF." />
      <HrNav can={can} current="/hr/reports" />
      <Section title="Reports">
        <ul className="divide-y divide-line">
          {HR_REPORT_SLUGS.filter((s) => (pay.includes(s) ? can('hr.payroll.view') : can('hr.reports.view'))).map((s) => (
            <li key={s} className="py-3"><Link className="font-semibold text-primary hover:underline" href={`/hr/reports/${s}`}>{HR_REPORT_TITLES[s]}</Link><p className="text-sm text-muted">{ABOUT[s]}</p></li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

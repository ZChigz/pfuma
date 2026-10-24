import { notFound } from 'next/navigation';
import { getHrAccess as getAccess } from '@/lib/hr/access';
import { HR_REPORT_SLUGS, HR_REPORT_TITLES, StaffReturnColumns, runHrReport, type HrReportSlug } from '@/lib/hr/reports';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section, Td, Th } from '@/components/finance/shared';
import { fieldClass } from '@/components/finance/format';
import { HrNav } from '@/components/hr/HrNav';

export const metadata = { title: 'HR report · Pfuma' };

export default async function ReportPage({ params, searchParams }: { params: { slug: string }; searchParams: Record<string, string | undefined> }) {
  if (!(HR_REPORT_SLUGS as readonly string[]).includes(params.slug)) notFound();
  const slug = params.slug as HrReportSlug;
  const { user, can } = await getAccess();
  let t;
  try { t = await runHrReport(user, slug, searchParams); } catch (e) { if (e instanceof ServiceError && e.status < 500) return <AccessDenied message={e.status === 403 ? undefined : e.message} />; throw e; }
  const qs = new URLSearchParams(Object.entries(searchParams).filter(([, v]) => v) as [string, string][]);
  const file = (f: string) => `/api/hr/reports/${slug}?${new URLSearchParams([...Array.from(qs.entries()), ['format', f]]).toString()}`;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title={HR_REPORT_TITLES[slug]} description={t.subtitle} breadcrumbs={[{ label: 'HR & Staff', href: '/hr' }, { label: 'Reports', href: '/hr/reports' }, { label: HR_REPORT_TITLES[slug] }]}
        actions={<div className="flex gap-3 text-sm"><a className="underline" href={file('xlsx')}>Excel</a><a className="underline" href={file('csv')}>CSV</a><a className="underline" href={file('pdf')}>PDF</a></div>} />
      <HrNav can={can} current="/hr/reports" />
      <form method="get" className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3">
        {slug === 'headcount' && <select name="by" defaultValue={searchParams.by ?? 'department'} className={fieldClass} aria-label="Group by">{['department', 'category', 'employer', 'gender', 'ageBand'].map((x) => <option key={x} value={x}>{x === 'ageBand' ? 'age band' : x}</option>)}</select>}
        {slug === 'attendance' && <input type="month" name="month" defaultValue={searchParams.month} className={fieldClass} aria-label="Month" />}
        {['payroll-summary', 'statutory', 'wage-bill'].includes(slug) && <input name="year" defaultValue={searchParams.year ?? String(new Date().getFullYear())} className={fieldClass} aria-label="Year" inputMode="numeric" />}
        {slug === 'leave' && <><input type="date" name="from" defaultValue={searchParams.from} className={fieldClass} aria-label="From" /><input type="date" name="to" defaultValue={searchParams.to} className={fieldClass} aria-label="To" /><label className="flex items-center gap-1 text-sm"><input type="checkbox" name="week" value="1" defaultChecked={!!searchParams.week} /> This week only</label></>}
        {slug === 'staff-returns' && <><select name="employer" defaultValue={searchParams.employer ?? ''} className={fieldClass} aria-label="Paid by"><option value="">Government and school</option><option value="GOVERNMENT">Government-paid</option><option value="SCHOOL">School-paid</option></select>
          <input name="columns" defaultValue={searchParams.columns ?? ''} placeholder={`Columns: ${StaffReturnColumns.join(',')}`} className={`${fieldClass} min-w-[18rem] flex-1`} aria-label="Columns" /></>}
        {['headcount', 'attendance', 'payroll-summary', 'statutory', 'wage-bill', 'leave', 'staff-returns'].includes(slug) && <button className="h-11 rounded-full bg-primary px-5 text-sm font-semibold text-white">Show</button>}
      </form>
      <Section title={t.title}>
        <div className="overflow-x-auto"><table className="w-full min-w-[34rem]"><thead><tr>{t.headers.map((h, i) => <Th key={i} className={t.align[i] === 'right' ? 'text-right' : ''}>{h}</Th>)}</tr></thead><tbody>
          {t.rows.map((r, i) => (<tr key={i} className="border-t border-line">{r.map((c, j) => <Td key={j} className={t.align[j] === 'right' ? 'text-right' : ''}>{c}</Td>)}</tr>))}
          {t.rows.length === 0 && <tr><Td className="text-muted">Nothing to show.</Td></tr>}
          {t.totals && <tr className="border-t-2 border-line font-semibold">{t.totals.map((c, j) => <Td key={j} className={t.align[j] === 'right' ? 'text-right' : ''}>{c}</Td>)}</tr>}
        </tbody></table></div>
      </Section>
    </div>
  );
}

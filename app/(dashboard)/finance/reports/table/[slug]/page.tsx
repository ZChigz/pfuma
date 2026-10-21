import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { REPORT_SLUGS, REPORT_TITLES, runReport, type ReportSlug } from '@/lib/finance/report-tables';
import { listFunds } from '@/lib/finance/setup';
import { getScopedDb } from '@/lib/scoped-db';
import { todayInHarare } from '@/lib/finance/common';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { PrintButton, Section, Td, Th } from '@/components/finance/shared';
import { fieldClass } from '@/components/finance/format';

export const metadata = { title: 'Finance report · Pfuma' };

export default async function ReportTablePage({ params, searchParams }: { params: { slug: string }; searchParams: Record<string, string | undefined> }) {
  const { user, can } = await getAccess();
  if (!can('finance.reports.view')) return <AccessDenied />;
  if (!(REPORT_SLUGS as readonly string[]).includes(params.slug)) notFound();
  const slug = params.slug as ReportSlug;
  const db = getScopedDb(user.schoolId, user.id);
  const filters = { from: searchParams.from, to: searchParams.to, fundId: searchParams.fundId, currency: searchParams.currency, termId: searchParams.termId, classId: searchParams.classId };
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const [t, funds, terms, classes] = await Promise.all([
    runReport(user, slug, clean),
    listFunds(user),
    db.academicTerm.findMany({ where: { schoolId: user.schoolId }, orderBy: { startDate: 'desc' }, select: { id: true, name: true } }),
    db.schoolClass.findMany({ where: { schoolId: user.schoolId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const qs = new URLSearchParams(clean as Record<string, string>).toString();
  const link = (format: string) => `/api/finance/reports/table/${slug}?format=${format}${qs ? `&${qs}` : ''}`;
  const today = todayInHarare();
  const termBased = ['collection', 'expenditure-vs-budget', 'arrears-ageing'].includes(slug);
  return (
    <div className="flex flex-col gap-4 pb-8 print:gap-2">
      <PageHeader title={REPORT_TITLES[slug]} description={t.subtitle} breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Reports', href: '/finance/reports' }, { label: REPORT_TITLES[slug] }]} />
      <form className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-3 print:hidden" action={`/finance/reports/table/${slug}`}>
        {!termBased && <label className="flex flex-col gap-1 text-sm font-medium text-ink">From<input type="date" name="from" defaultValue={filters.from ?? `${today.slice(0, 8)}01`} className={fieldClass} /></label>}
        {!termBased && <label className="flex flex-col gap-1 text-sm font-medium text-ink">To<input type="date" name="to" defaultValue={filters.to ?? today} className={fieldClass} /></label>}
        {termBased && <label className="flex flex-col gap-1 text-sm font-medium text-ink">Term<select name="termId" defaultValue={filters.termId ?? ''} className={`${fieldClass} min-w-[10rem]`}><option value="">Current</option>{terms.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">Fund<select name="fundId" defaultValue={filters.fundId ?? ''} className={`${fieldClass} min-w-[10rem]`}><option value="">All funds</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">Currency<select name="currency" defaultValue={filters.currency ?? ''} className={fieldClass}><option value="">Both</option><option value="USD">US dollars</option><option value="ZIG">ZiG</option></select></label>
        {['collection', 'arrears-ageing'].includes(slug) && <label className="flex flex-col gap-1 text-sm font-medium text-ink">Class<select name="classId" defaultValue={filters.classId ?? ''} className={fieldClass}><option value="">All</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <button className="inline-flex min-h-[44px] items-center rounded-full bg-primary px-5 text-sm font-semibold text-white">Show</button>
      </form>
      <Section title={`${t.rows.length} row${t.rows.length === 1 ? '' : 's'}`}
        action={<div className="flex flex-wrap items-center gap-3 print:hidden">
          {can('finance.reports.export') && <><a className="text-sm font-semibold text-primary underline" href={link('xlsx')}>Excel</a><a className="text-sm font-semibold text-primary underline" href={link('pdf')}>PDF</a><a className="text-sm font-semibold text-primary underline" href={link('csv')}>CSV</a></>}
          <PrintButton />
        </div>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead><tr>{t.headers.map((h, i) => <Th key={i} className={t.align[i] === 'right' ? 'text-right' : ''}>{h}</Th>)}</tr></thead>
            <tbody>
              {t.rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <Td key={j} className={t.align[j] === 'right' ? 'text-right tabular-nums' : ''}>{c}</Td>)}</tr>)}
              {t.rows.length === 0 && <tr><Td className="text-muted">Nothing to show for these filters.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
      <p className="text-sm print:hidden"><Link className="underline" href="/finance/reports">All reports</Link></p>
    </div>
  );
}

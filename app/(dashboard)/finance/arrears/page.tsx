import { getAccess } from '@/lib/access';
import { arrearsList } from '@/lib/finance/statements';
import { getScopedDb } from '@/lib/scoped-db';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { ArrearsTable } from '@/components/finance/ArrearsTable';
import { MoneyLine, Section, fieldClass } from '@/components/finance/shared';

export const metadata = { title: 'Arrears · Pfuma' };

export default async function ArrearsPage({ searchParams }: { searchParams: { classId?: string; currency?: string; termId?: string; onlyOverdue?: string; search?: string } }) {
  const { user, can } = await getAccess();
  if (!can('finance.statements.view') && !can('finance.accounts.view') && !can('finance.reports.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const q = {
    classId: searchParams.classId || undefined, termId: searchParams.termId || undefined, search: searchParams.search || undefined,
    currency: searchParams.currency === 'USD' || searchParams.currency === 'ZIG' ? searchParams.currency : undefined, onlyOverdue: searchParams.onlyOverdue === '1' ? true : undefined,
  };
  const [{ rows, totals }, classes, terms] = await Promise.all([
    arrearsList(user, q),
    db.schoolClass.findMany({ where: { schoolId: user.schoolId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.academicTerm.findMany({ where: { schoolId: user.schoolId }, orderBy: { startDate: 'desc' }, select: { id: true, name: true } }),
  ]);
  const csv = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Arrears" description="Who owes what, oldest first. Each currency is shown on its own. A learner with a payment plan that is up to date shows as “In force”." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Arrears' }]} />
      <form className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-3" action="/finance/arrears">
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">Class<select name="classId" defaultValue={q.classId ?? ''} className={`${fieldClass} min-w-[10rem]`}><option value="">All</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">Term<select name="termId" defaultValue={q.termId ?? ''} className={`${fieldClass} min-w-[10rem]`}><option value="">All terms</option>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">Currency<select name="currency" defaultValue={q.currency ?? ''} className={fieldClass}><option value="">Both</option><option value="USD">US dollars</option><option value="ZIG">ZiG</option></select></label>
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">Search<input name="search" defaultValue={q.search ?? ''} className={fieldClass} placeholder="Name or admission no." /></label>
        <label className="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" name="onlyOverdue" value="1" defaultChecked={!!q.onlyOverdue} /> Overdue only</label>
        <button className="inline-flex min-h-[44px] items-center rounded-full bg-primary px-5 text-sm font-semibold text-white">Filter</button>
      </form>
      <Section title={`${rows.length} learner${rows.length === 1 ? '' : 's'} owing`} hint="Ageing runs from the start of the term the fee belongs to."
        action={can('finance.reports.export') ? <a className="text-sm underline" href={`/api/finance/reports/table/arrears-ageing?format=csv&${csv}`}>Download (CSV)</a> : undefined}>
        <div className="mb-3 grid gap-2 text-sm sm:grid-cols-3">
          <p><span className="text-muted">Total owed: </span><MoneyLine totals={totals.owed} /></p>
          <p><span className="text-muted">Over 90 days: </span><MoneyLine totals={{ USD: totals.buckets.USD.D90P, ZIG: totals.buckets.ZIG.D90P }} /></p>
          <p><span className="text-muted">Current: </span><MoneyLine totals={{ USD: totals.buckets.USD.CURRENT, ZIG: totals.buckets.ZIG.CURRENT }} /></p>
        </div>
        <ArrearsTable rows={rows} canSend={can('finance.statements.view')} />
      </Section>
    </div>
  );
}

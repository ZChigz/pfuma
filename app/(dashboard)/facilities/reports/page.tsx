import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { facilitiesReport } from '@/lib/facilities/overview';
import { ANY_FACILITIES } from '@/lib/facilities/people';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { PrintButton, Section } from '@/components/finance/shared';

export const metadata = { title: 'Reports · Facilities · Pfuma' };

export default async function FacilitiesReportsPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const { user, can } = await getAccess();
  if (!ANY_FACILITIES.some((k) => can(k))) return <AccessDenied />;
  const ok = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const r = await facilitiesReport(user, { from: ok(searchParams.from), to: ok(searchParams.to) }).catch((e) => { if (e instanceof ServiceError || (e as Error).name === 'ZodError') return null; throw e; });
  if (!r) return <AccessDenied />;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Facilities reports" description={`${r.from} to ${r.to}. Each part shows only what you are allowed to see; money in each currency on its own.`} />
      <form className="flex flex-wrap items-end gap-2 print:hidden" method="get">
        <label className="flex flex-col text-xs text-muted">From<input className="min-h-[44px] rounded-xl border border-line px-3 text-base" type="date" name="from" defaultValue={r.from} /></label>
        <label className="flex flex-col text-xs text-muted">To<input className="min-h-[44px] rounded-xl border border-line px-3 text-base" type="date" name="to" defaultValue={r.to} /></label>
        <button className="min-h-[44px] rounded-xl bg-primary px-4 text-sm font-semibold text-white" type="submit">Show</button>
        <PrintButton />
      </form>
      {r.sections.length === 0 && <p className="text-sm text-muted">Nothing to report for the parts you can see.</p>}
      {r.sections.map((s) => (
        <Section key={s.part} title={s.title}>
          {s.rows.length === 0 ? <p className="text-sm text-muted">Nothing in this period.</p> : (
            <dl className="flex flex-col gap-1 rounded-xl border border-line bg-white p-3 text-sm">
              {s.rows.map((x) => <div key={x.label} className="flex items-baseline justify-between gap-3"><dt className="text-muted">{x.label}</dt><dd className="font-semibold text-ink">{x.value}</dd></div>)}
            </dl>
          )}
          <p className="mt-1 text-xs print:hidden"><Link className="text-primary underline" href={s.link}>Open</Link></p>
        </Section>
      ))}
    </div>
  );
}

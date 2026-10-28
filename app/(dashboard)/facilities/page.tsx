import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { facilitiesOverview } from '@/lib/facilities/overview';
import { ANY_FACILITIES } from '@/lib/facilities/people';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata = { title: 'Facilities & Operations · Pfuma' };
const TONE = { ok: 'text-success', warn: 'text-warn', bad: 'text-danger' } as const;

export default async function FacilitiesOverviewPage() {
  const { user, can } = await getAccess();
  if (!ANY_FACILITIES.some((k) => can(k))) return <AccessDenied />;
  const { cards, hidden } = await facilitiesOverview(user);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Facilities & Operations" description="What needs attention today in the parts you look after." />
      {cards.length === 0 ? <p className="text-sm text-muted">{hidden > 0 ? 'The parts you look after are switched off for this school.' : 'There is nothing to show yet.'}</p> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Link key={c.part} href={c.href} className="flex flex-col gap-2 rounded-xl border border-line bg-white p-4 hover:bg-tint">
              <h2 className="text-base font-bold text-ink">{c.title}</h2>
              <dl className="flex flex-col gap-1 text-sm">
                {c.figures.map((f) => <div key={f.label} className="flex items-baseline justify-between gap-3"><dt className="text-muted">{f.label}</dt><dd className={`font-semibold ${TONE[f.tone ?? 'ok'] ?? ''}`}>{f.value}</dd></div>)}
              </dl>
            </Link>
          ))}
        </div>
      )}
      <p className="text-sm"><Link className="text-primary underline" href="/facilities/reports">Reports for a period</Link></p>
    </div>
  );
}

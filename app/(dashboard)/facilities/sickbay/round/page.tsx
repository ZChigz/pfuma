import { getAccess } from '@/lib/access';
import { medicationRound } from '@/lib/facilities/sickbay';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { RowAction, Section } from '@/components/finance/shared';
import { SickBayNav } from '@/components/facilities/SickBayNav';

export const metadata = { title: 'Medication round · Sick bay · Pfuma' };

export default async function RoundPage({ searchParams }: { searchParams: { date?: string } }) {
  const { user, can } = await getAccess();
  if (!can('facilities.sickbay.record')) return <AccessDenied />;
  const round = await medicationRound(user, searchParams.date).catch((e) => { if ((e instanceof ServiceError && e.status === 422) || (e as Error).name === 'ZodError') return null; throw e; });
  const rows = round?.rows ?? [];
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Medication round" description={`${round?.date ?? ''}. Medicine the matron or the office keeps for boarders, by time. Tap Given when it has been taken.`} />
      <SickBayNav can={can} current="/facilities/sickbay/round" />
      <Section title={`${rows.filter((r) => r.givenAt).length} of ${rows.length} given`}>
        {rows.length === 0 ? <p className="text-sm text-muted">No medicine is kept by the school for any learner today.</p> : (
          <ul className="flex flex-col gap-2">{rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white p-3 text-sm">
              <span><b>{r.dueTime}</b> · {r.student}<br /><span className="text-muted">{r.medicine}{r.dose ? `, ${r.dose}` : ''}</span></span>
              {r.givenAt ? <Badge variant="success" label={`Given ${new Date(r.givenAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Harare' })}`} />
                : r.missed ? <Badge variant="danger" label="Missed" />
                : <RowAction label="Given" variant="primary" url={`/api/facilities/sickbay/round/${r.id}/give`} body={{}} done="Ticked" />}
            </li>
          ))}</ul>
        )}
        {rows.length > 0 && !round?.closed && <div className="mt-3"><RowAction label="Close the round" variant="secondary" url="/api/facilities/sickbay/round" body={{ date: round?.date }} confirm="Anything not ticked is flagged as missed and the matron is told." done="Round closed" /></div>}
      </Section>
    </div>
  );
}

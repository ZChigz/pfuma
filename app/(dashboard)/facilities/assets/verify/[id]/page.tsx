import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { roundResult } from '@/lib/facilities/assets';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { RowAction, Section, Td, Th } from '@/components/finance/shared';
import { AssetNav } from '@/components/facilities/AssetNav';
import { VerifyClient } from '@/components/facilities/VerifyClient';

export const metadata = { title: 'Verification round · Pfuma' };

export default async function RoundPage({ params }: { params: { id: string } }) {
  const { user, can } = await getAccess();
  if (!can('facilities.assets.verify') && !can('facilities.assets.manage') && !can('facilities.assets.view')) return <AccessDenied />;
  const r = await roundResult(user, params.id).catch((e) => { if (e instanceof ServiceError && e.status === 404) return null; throw e; });
  if (!r) notFound();
  const round = r!;
  const locations = (await getScopedDb(user.schoolId, user.id).facAsset.findMany({ distinct: ['location'], select: { location: true }, orderBy: { location: 'asc' } })).map((l) => l.location);
  const table = (rows: typeof round.found, extra?: (a: (typeof round.found)[number]) => React.ReactNode) => (
    <div className="overflow-x-auto"><table className="w-full min-w-[26rem]"><thead><tr><Th>Tag</Th><Th>Asset</Th><Th>Should be in</Th><Th>Found in</Th><Th /></tr></thead><tbody>
      {rows.map((a) => <tr key={a.assetId} className="border-t border-line"><Td className="font-mono">{a.tag}</Td><Td>{a.name}</Td><Td>{a.expectedLocation}</Td><Td>{a.scannedLocation ?? '—'}</Td><Td>{extra?.(a)}</Td></tr>)}
    </tbody></table></div>
  );
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title={round.name} breadcrumbs={[{ label: 'Verification', href: '/facilities/assets/verify' }, { label: round.name }]} />
      <AssetNav can={can} current="/facilities/assets/verify" />
      {can('facilities.assets.verify') && <VerifyClient roundId={round.id} closed={round.closed} locations={locations} />}
      <Section title={`Found (${round.found.length})`}>{round.found.length === 0 ? <p className="text-sm text-muted">Nothing scanned in its place yet.</p> : table(round.found)}</Section>
      <Section title={`Found in the wrong place (${round.wrongPlace.length})`}>
        {round.wrongPlace.length === 0 ? <p className="text-sm text-muted">None.</p> : table(round.wrongPlace, (a) => can('facilities.assets.verify') && !round.closed ? <RowAction label="Move it here" url={`/api/facilities/assets/rounds/${round.id}/move`} body={{ assetId: a.assetId }} done="Moved" /> : null)}
      </Section>
      <Section title={`Not found (${round.notFound.length})`} hint={round.closed ? undefined : 'Assets in service that have not been scanned yet.'}>{round.notFound.length === 0 ? <p className="text-sm text-muted">Every asset has been scanned.</p> : table(round.notFound)}</Section>
    </div>
  );
}

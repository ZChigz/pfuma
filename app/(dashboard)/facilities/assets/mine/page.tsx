import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { myAssets } from '@/lib/facilities/assets';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { RowAction, Section, Td, Th } from '@/components/finance/shared';
import { AssetNav } from '@/components/facilities/AssetNav';

export const metadata = { title: 'My assets · Pfuma' };

export default async function MyAssetsPage() {
  const { user, can } = await getAccess();
  if (!['view', 'manage', 'maintain', 'dispose', 'verify'].some((k) => can(`facilities.assets.${k}` as never))) return <AccessDenied />;
  const { pending, held } = await myAssets(user);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="My assets" description="Things handed to you, and the things you look after." />
      <AssetNav can={can} current="/facilities/assets/mine" />
      <Section title="Waiting for you to confirm" hint="Tap Confirm when you have the item in your hands.">
        {pending.length === 0 ? <p className="text-sm text-muted">Nothing is waiting.</p> : (
          <ul className="flex flex-col gap-2">{pending.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white p-3 text-sm"><span><span className="font-mono font-semibold">{p.tag}</span> {p.name} · now at {p.toLocation}</span><RowAction label="Confirm" variant="primary" url={`/api/facilities/assets/transfers/${p.id}/confirm`} done="Confirmed" /></li>
          ))}</ul>
        )}
      </Section>
      <Section title="Assets I look after">
        {held.length === 0 ? <p className="text-sm text-muted">None.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[24rem]"><thead><tr><Th>Tag</Th><Th>Name</Th><Th>Place</Th></tr></thead><tbody>
            {held.map((a) => <tr key={a.id} className="border-t border-line"><Td className="font-mono"><Link className="font-semibold text-primary underline" href={`/facilities/assets/${a.id}`}>{a.tag}</Link></Td><Td>{a.name}</Td><Td>{a.location}</Td></tr>)}
          </tbody></table></div>
        )}
      </Section>
    </div>
  );
}

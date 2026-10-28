import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { listRounds } from '@/lib/facilities/assets';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Section, Td, Th } from '@/components/finance/shared';
import { AssetNav } from '@/components/facilities/AssetNav';

export const metadata = { title: 'Verify assets · Pfuma' };

export default async function VerifyPage() {
  const { user, can } = await getAccess();
  if (!can('facilities.assets.verify') && !can('facilities.assets.manage') && !can('facilities.assets.view')) return <AccessDenied />;
  const rounds = await listRounds(user);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Annual verification" description="Walk the school and scan each tag where the asset stands. The system lists what was found, what was in the wrong place and what was not found."
        actions={can('facilities.assets.verify') && <FormAction label="Open a round" size="md" variant="primary" url="/api/facilities/assets/rounds" done="Round opened" fields={[{ name: 'name', label: 'Name', required: true, initial: `Verification ${new Date().getFullYear()}` }]} />} />
      <AssetNav can={can} current="/facilities/assets/verify" />
      <Section title="Rounds">
        {rounds.length === 0 ? <p className="text-sm text-muted">No rounds yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[24rem]"><thead><tr><Th>Name</Th><Th>Opened</Th><Th>Status</Th><Th /></tr></thead><tbody>
            {rounds.map((r) => <tr key={r.id} className="border-t border-line"><Td>{r.name}</Td><Td>{r.startedAt.slice(0, 10)}</Td><Td><Badge variant={r.closed ? 'neutral' : 'warning'} label={r.closed ? 'Closed' : 'Scanning'} /></Td><Td><Link className="inline-flex min-h-[44px] items-center font-semibold text-primary underline" href={`/facilities/assets/verify/${r.id}`}>{r.closed ? 'Result' : 'Scan'}</Link></Td></tr>)}
          </tbody></table></div>
        )}
      </Section>
    </div>
  );
}

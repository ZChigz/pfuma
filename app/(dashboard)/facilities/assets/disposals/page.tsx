import { getAccess } from '@/lib/access';
import { listDisposals } from '@/lib/facilities/assets';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { RowAction, Section, Td, Th } from '@/components/finance/shared';
import { AssetNav } from '@/components/facilities/AssetNav';

export const metadata = { title: 'Disposals · Assets · Pfuma' };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const money = (c: number, cur: string) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;

export default async function DisposalsPage() {
  const { user, can } = await getAccess();
  if (!can('facilities.assets.dispose') && !can('facilities.assets.manage') && !can('facilities.assets.view')) return <AccessDenied />;
  const rows = await listDisposals(user);
  const approver = can('facilities.assets.dispose');
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Disposals" description="An asset is disposed of once. The Head approves, and the Owner too above the school's value limit. Nobody approves their own request." />
      <AssetNav can={can} current="/facilities/assets/disposals" />
      <Section title="Requests">
        {rows.length === 0 ? <p className="text-sm text-muted">No disposals yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[44rem]"><thead><tr><Th>Asset</Th><Th>How</Th><Th>Why</Th><Th className="text-right">Cost</Th><Th>Approvals</Th><Th /></tr></thead><tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <Td><span className="font-mono">{r.tag}</span> {r.asset}<div className="text-xs text-muted">asked by {r.requestedBy}</div></Td>
                <Td>{label(r.method)}{r.proceedsCents ? <div className="text-xs text-muted">received {money(r.proceedsCents, r.currency ?? 'USD')}</div> : null}</Td>
                <Td>{r.reason}{r.rejectionReason && <div className="text-xs text-muted">Refused: {r.rejectionReason}</div>}</Td>
                <Td className="text-right">{money(r.valueCents, r.valueCurrency)}</Td>
                <Td className="text-xs">Head: {r.headApprovedBy ?? 'waiting'}<br />{r.needsOwner ? `Owner: ${r.ownerApprovedBy ?? 'waiting'}` : 'Owner not needed'}</Td>
                <Td>{r.status === 'PENDING' ? (approver && r.requestedById !== user.id && r.headApprovedById !== user.id && r.ownerApprovedById !== user.id ? (
                  <div className="flex gap-2"><RowAction label="Approve" variant="primary" url={`/api/facilities/assets/disposals/${r.id}/decide`} body={{ decision: 'APPROVE' }} done="Approved" />
                    <RowAction label="Refuse" variant="danger" url={`/api/facilities/assets/disposals/${r.id}/decide`} body={{ decision: 'REJECT' }} reason={{ label: 'Why is it refused?', min: 3 }} done="Refused" /></div>
                ) : <span className="text-xs text-muted">{r.requestedById === user.id ? 'Yours: someone else decides' : 'Waiting for approval'}</span>) : <Badge variant={r.status === 'APPROVED' ? 'success' : 'neutral'} label={label(r.status)} />}</Td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Section>
    </div>
  );
}

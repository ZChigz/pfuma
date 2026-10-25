import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { listCounts, listWriteoffs } from '@/lib/facilities/inventory';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { RowAction, Section, Td, Th } from '@/components/finance/shared';
import { InventoryNav } from '@/components/facilities/InventoryNav';

export const metadata = { title: 'Stock approvals · Pfuma' };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export default async function ApprovalsPage() {
  const { user, can } = await getAccess();
  if (!can('facilities.inventory.writeoff') && !can('facilities.inventory.issue') && !can('facilities.inventory.count')) return <AccessDenied />;
  const approver = can('facilities.inventory.writeoff');
  const [writeoffs, counts] = await Promise.all([listWriteoffs(user), can('facilities.inventory.count') || approver ? listCounts(user) : Promise.resolve([])]);
  const waiting = counts.filter((c) => c.status === 'SUBMITTED');
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Stock approvals" description="Nothing is written off, and no large count difference is posted, until the Head approves. Nobody approves their own." />
      <InventoryNav can={can} current="/facilities/inventory/approvals" />
      <Section title="Write-offs">
        {writeoffs.length === 0 ? <p className="text-sm text-muted">No write-off requests.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[40rem]"><thead><tr><Th>Item</Th><Th>Store</Th><Th className="text-right">Quantity</Th><Th>Why</Th><Th>Asked by</Th><Th /></tr></thead><tbody>
            {writeoffs.map((w) => (
              <tr key={w.id} className="border-t border-line align-top">
                <Td>{w.item}</Td><Td>{w.store}</Td><Td className="text-right">{w.qty}</Td>
                <Td>{label(w.writeoffReason)}: {w.reason}{w.decisionReason && <p className="text-xs text-muted">{w.decisionReason}</p>}</Td>
                <Td>{w.requestedBy}</Td>
                <Td>{w.status === 'PENDING' ? (approver && w.requestedById !== user.id ? (
                  <div className="flex gap-2"><RowAction label="Approve" variant="primary" url={`/api/facilities/inventory/writeoffs/${w.id}/decide`} body={{ decision: 'APPROVE' }} done="Written off" />
                    <RowAction label="Refuse" variant="danger" url={`/api/facilities/inventory/writeoffs/${w.id}/decide`} body={{ decision: 'REJECT' }} reason={{ label: 'Why is it refused?', min: 3 }} done="Refused" /></div>
                ) : <span className="text-xs text-muted">{w.requestedById === user.id ? 'Yours: someone else decides' : 'Waiting for the Head'}</span>) : <Badge variant={w.status === 'APPROVED' ? 'success' : 'neutral'} label={label(w.status)} />}</Td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Section>
      <Section title="Count differences waiting for approval">
        {waiting.length === 0 ? <p className="text-sm text-muted">Nothing is waiting.</p> : (
          <ul className="flex flex-col gap-2">
            {waiting.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white p-3 text-sm">
                <span><Link className="font-semibold text-primary underline" href={`/facilities/inventory/counts/${c.id}`}>{c.store}</Link> · {c.countedAt.slice(0, 10)}</span>
                {approver && c.submittedById !== user.id ? (
                  <span className="flex gap-2"><RowAction label="Approve and post" variant="primary" url={`/api/facilities/inventory/counts/${c.id}/decide`} body={{ decision: 'APPROVE' }} done="Differences posted" />
                    <RowAction label="Refuse" variant="danger" url={`/api/facilities/inventory/counts/${c.id}/decide`} body={{ decision: 'REJECT' }} reason={{ label: 'Why is it refused?', min: 3 }} done="Refused" /></span>
                ) : <span className="text-xs text-muted">{c.submittedById === user.id ? 'You submitted it: someone else decides' : 'Waiting for the Head'}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

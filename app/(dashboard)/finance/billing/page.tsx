import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { listBillingRuns } from '@/lib/finance/billing';
import { listStructures } from '@/lib/finance/structures';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { BillingPanel } from '@/components/finance/BillingPanel';
import { ClosedNotice, Notice, Section, Td, Th } from '@/components/finance/shared';

export const metadata = { title: 'Billing · Pfuma' };

export default async function BillingPage() {
  const { user, can } = await getAccess();
  if (!can('finance.billing.run')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await db.$tx((tx) => getViewTerm(user.schoolId, tx));
  const header = <PageHeader title="Billing" description="Charge every enrolled learner the term's approved fee structure. Discounts and sponsor shares are worked out as part of billing." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Billing' }]} />;
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" description="Set up an academic year and its terms in School Settings first." cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;
  const [{ structures }, runs, classes] = await Promise.all([
    listStructures(user, term.id), listBillingRuns(user, term.id),
    db.schoolClass.findMany({ where: { schoolId: user.schoolId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const approved = structures.find((s) => s.status === 'APPROVED');
  const closed = term.status === 'CLOSED';
  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      <p className="text-sm text-muted">{term.name}</p>
      {closed && <ClosedNotice termName={term.name} />}
      {!approved && <Notice tone="warn">{term.name} has no approved fee structure yet. The bursar prepares it and the Head approves it on the <Link className="underline" href="/finance/fees">fees page</Link>.</Notice>}
      {approved && !closed && <Section title="Bill the term" hint={`Uses fee structure version ${approved.version}.`}><BillingPanel termId={term.id} classes={classes} /></Section>}
      <Section title="Past runs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem]">
            <thead><tr><Th>When</Th><Th className="text-right">Charged</Th><Th className="text-right">Already charged</Th><Th className="text-right">Not enrolled</Th></tr></thead>
            <tbody>
              {runs.map((r) => <tr key={r.id} className="border-t border-line"><Td>{r.at.slice(0, 16).replace('T', ' ')}</Td><Td className="text-right">{r.charged}</Td><Td className="text-right">{r.skippedCharged}</Td><Td className="text-right">{r.skippedInactive}</Td></tr>)}
              {runs.length === 0 && <tr><Td className="text-muted">Nothing billed yet.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

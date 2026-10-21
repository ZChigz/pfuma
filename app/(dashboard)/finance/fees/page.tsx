import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { listCatalog, listStructures } from '@/lib/finance/structures';
import { listFunds } from '@/lib/finance/setup';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { FormAction } from '@/components/finance/FormAction';
import { ClosedNotice, RowAction, Section, StatusBadge, Td, Th } from '@/components/finance/shared';

export const metadata = { title: 'Fees · Pfuma' };

const STATUS_WORDS: Record<string, string> = { DRAFT: 'Draft', SUBMITTED: 'Waiting for the Head', APPROVED: 'Approved', SUPERSEDED: 'Replaced by a newer version' };

export default async function FeesPage() {
  const { user, can } = await getAccess();
  if (!can('finance.fees.view') && !can('finance.fees.manage') && !can('finance.charges.create') && !can('finance.billing.run') && !can('finance.fees.approve')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await db.$tx((tx) => getViewTerm(user.schoolId, tx));
  const header = <PageHeader title="Fees" description="The school's fee items, and the fee structure of each term: what each group of learners pays. The bursar prepares it, the Head approves it, then the term is billed." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Fees' }]} />;
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" description="Set up an academic year and its terms in School Settings first." cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;
  const [catalog, funds, { structures }, terms] = await Promise.all([
    listCatalog(user), listFunds(user), listStructures(user, term.id),
    db.academicTerm.findMany({ where: { schoolId: user.schoolId }, orderBy: { startDate: 'desc' }, select: { id: true, name: true } }),
  ]);
  const closed = term.status === 'CLOSED';
  const manage = can('finance.fees.manage');
  const activeFunds = funds.filter((f) => f.active);
  const working = structures.find((s) => s.status === 'DRAFT' || s.status === 'SUBMITTED');
  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      <p className="text-sm text-muted">{term.name}</p>
      {closed && <ClosedNotice termName={term.name} />}
      <Section title={`Fee structure for ${term.name}`} hint="Only an approved structure can be billed. After billing it is never edited: a change is a new version, and the difference is billed as an adjustment."
        action={manage && !closed && !working ? (
          <div className="flex flex-wrap gap-2">
            <FormAction label="Start a fee structure" variant="primary" size="md" url="/api/finance/structures" extra={{ termId: term.id }} done="Draft created" intro="Start empty, or copy another term's approved structure with a percentage increase. Amounts are rounded to the nearest dollar."
              fields={[
                { name: 'copyFromTermId', label: 'Copy from', type: 'select', options: terms.filter((t) => t.id !== term.id).map((t) => ({ value: t.id, label: t.name })), hint: 'Leave empty to start with no lines' },
                { name: 'increasePct', label: 'Increase (%)', type: 'number', hint: 'For example 10 for ten percent' },
                { name: 'note', label: 'Note', maxLength: 200 },
              ]} />
          </div>
        ) : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem]">
            <thead><tr><Th>Version</Th><Th>Status</Th><Th>Lines</Th><Th>Prepared by</Th><Th>Approved by</Th><Th /></tr></thead>
            <tbody>
              {structures.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <Td><Link className="font-semibold underline" href={`/finance/fees/${s.id}`}>Version {s.version}</Link></Td>
                  <Td><StatusBadge status={s.status === 'SUBMITTED' ? 'PENDING' : s.status} /> <span className="text-xs text-muted">{STATUS_WORDS[s.status]}{s.billed ? ' · billed' : ''}</span></Td>
                  <Td>{s.lines.length}</Td><Td>{s.createdBy ?? '—'}</Td><Td>{s.approvedBy ?? '—'}</Td>
                  <Td><Link className="text-sm underline" href={`/finance/fees/${s.id}`}>Open</Link></Td>
                </tr>
              ))}
              {structures.length === 0 && <tr><Td className="text-muted">No fee structure for {term.name} yet.</Td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <a className="underline" href={`/api/finance/schedule/pdf?termId=${term.id}`}>Fee schedule for parents (PDF)</a>
          {can('finance.billing.run') && <Link className="underline" href="/finance/billing">Bill the term</Link>}
        </div>
      </Section>
      <Section title="Fee items" hint="The names the school charges under, each in one fund. Recurring items are billed every term; one-off items (a trip, an entry fee) are charged when needed."
        action={manage ? (
          <FormAction label="Add a fee item" size="md" url="/api/finance/catalog" done="Fee item added"
            fields={[
              { name: 'name', label: 'Name', required: true, placeholder: 'Tuition', maxLength: 60 },
              { name: 'fundId', label: 'Fund', type: 'select', required: true, options: activeFunds.map((f) => ({ value: f.id, label: f.name })) },
              { name: 'recurring', label: 'Billed', type: 'select', required: true, initial: 'true', options: [{ value: 'true', label: 'Every term' }, { value: 'false', label: 'One-off' }] },
            ]} />
        ) : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem]">
            <thead><tr><Th>Name</Th><Th>Fund</Th><Th>Billed</Th><Th /></tr></thead>
            <tbody>
              {catalog.map((c) => (
                <tr key={c.id} className={`border-t border-line ${c.active ? '' : 'text-muted'}`}>
                  <Td>{c.name}{!c.active && ' (off)'}</Td><Td>{c.fundName}</Td><Td>{c.recurring ? 'Every term' : 'One-off'}</Td>
                  <Td>{manage && <RowAction label={c.active ? 'Switch off' : 'Switch on'} variant="ghost" url={`/api/finance/catalog/${c.id}`} method="PATCH" body={{ active: !c.active }} done="Saved" />}</Td>
                </tr>
              ))}
              {catalog.length === 0 && <tr><Td className="text-muted">No fee items yet.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getStructure, listCatalog } from '@/lib/finance/structures';
import { enabledCurrencies } from '@/lib/finance/common';
import { getScopedDb } from '@/lib/scoped-db';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { LineForm } from '@/components/finance/LineForm';
import { Money, Notice, RowAction, Section, StatusBadge, Td, Th } from '@/components/finance/shared';
import { ServiceError } from '@/lib/api';

export const metadata = { title: 'Fee structure · Pfuma' };

export default async function StructurePage({ params }: { params: { id: string } }) {
  const { user, can } = await getAccess();
  if (!can('finance.fees.view') && !can('finance.fees.manage') && !can('finance.fees.approve') && !can('finance.billing.run') && !can('finance.charges.create')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  let s;
  try { s = await getStructure(user, params.id); } catch (e) { if (e instanceof ServiceError && e.status === 404) notFound(); throw e; }
  const [catalog, levels, classes, combos, currencies] = await Promise.all([
    listCatalog(user),
    db.level.findMany({ where: { schoolId: user.schoolId, active: true }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
    db.schoolClass.findMany({ where: { schoolId: user.schoolId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.subjectCombination.findMany({ where: { schoolId: user.schoolId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.$tx((tx) => enabledCurrencies(tx, user.schoolId)),
  ]);
  const draft = s.status === 'DRAFT';
  const manage = can('finance.fees.manage');
  const approve = can('finance.fees.approve');
  const mine = s.createdBy !== null && false;
  void mine;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title={`${s.termName}: fee structure, version ${s.version}`} description="Lines say what each group of learners pays. Learners who match more than one line pay each of them." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Fees', href: '/finance/fees' }, { label: `Version ${s.version}` }]} />
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={s.status === 'SUBMITTED' ? 'PENDING' : s.status} />
        <span className="text-sm text-muted">{s.status === 'SUBMITTED' ? 'Waiting for the Head to approve' : s.status === 'APPROVED' ? (s.billed ? 'Approved and billed. It cannot be edited.' : 'Approved, ready to bill') : s.status === 'SUPERSEDED' ? 'Replaced by a newer version' : 'Draft'}</span>
        {s.createdBy && <span className="text-sm text-muted">Prepared by {s.createdBy}{s.approvedBy ? ` · approved by ${s.approvedBy}` : ''}</span>}
      </div>
      {s.status === 'APPROVED' && s.billed && can('finance.billing.run') && (
        <Notice tone="info">To change a billed fee, start a new version from the fees page. After the Head approves it, “Bill the difference” charges or credits each learner by exactly what changed.</Notice>
      )}
      <div className="flex flex-wrap gap-2">
        {draft && manage && <RowAction label="Send to the Head" variant="primary" url={`/api/finance/structures/${s.id}/submit`} done="Sent to the Head" confirm="Once sent, the lines cannot be changed unless the Head returns it." />}
        {s.status === 'SUBMITTED' && approve && <RowAction label="Approve" variant="primary" url={`/api/finance/structures/${s.id}/approve`} done="Approved" confirm="Approving makes this the structure that is billed. Someone who prepared it cannot approve it." />}
        {s.status === 'SUBMITTED' && approve && <RowAction label="Return for changes" variant="secondary" url={`/api/finance/structures/${s.id}/return`} done="Returned" />}
        {draft && manage && <RowAction label="Delete this draft" variant="danger" url={`/api/finance/structures/${s.id}`} method="DELETE" confirm="Delete this draft and all its lines?" redirectTo="/finance/fees" done="Draft deleted" />}
        {s.status === 'APPROVED' && s.billed && can('finance.billing.run') && <RowAction label="Bill the difference" variant="secondary" url={`/api/finance/structures/${s.id}/difference`} done="Difference billed" confirm="Charges or credits each learner by the difference between this version and the one already billed." />}
        <a className="inline-flex min-h-[40px] items-center text-sm underline" href={`/api/finance/schedule/pdf?termId=${s.termId}`}>Fee schedule (PDF)</a>
      </div>
      <Section title={`${s.lines.length} line${s.lines.length === 1 ? '' : 's'}`} action={draft && manage ? <LineForm structureId={s.id} items={catalog.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))} levels={levels} classes={classes} combinations={combos} currencies={currencies} /> : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem]">
            <thead><tr><Th>Fee</Th><Th>Fund</Th><Th>Who pays</Th><Th className="text-right">Amount</Th><Th className="text-right">Charged</Th><Th /></tr></thead>
            <tbody>
              {s.lines.map((l) => (
                <tr key={l.id} className="border-t border-line align-top">
                  <Td>{l.name}</Td><Td>{l.fundName}</Td><Td>{l.audience || 'Everyone'}</Td>
                  <Td className="text-right"><Money cents={l.amountCents} currency={l.currency} /></Td><Td className="text-right">{l.charged}</Td>
                  <Td>
                    {draft && manage && (
                      <div className="flex gap-2">
                        <LineForm structureId={s.id} items={catalog.map((c) => ({ id: c.id, name: c.name }))} levels={levels} classes={classes} combinations={combos} currencies={currencies}
                          initial={{ id: l.id, catalogItemId: l.catalogItemId, amount: (l.amountCents / 100).toFixed(2), currency: l.currency, levelIds: l.levelIds, boarding: l.boarding, classIds: l.classIds, combinationIds: l.combinationIds }} />
                        <RowAction label="Remove" variant="ghost" url={`/api/finance/structures/${s.id}/lines/${l.id}`} method="DELETE" done="Line removed" />
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
              {s.lines.length === 0 && <tr><Td className="text-muted">No lines yet. Add the fees this term.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
      <p className="text-sm"><Link className="underline" href="/finance/fees">Back to fees</Link></p>
    </div>
  );
}

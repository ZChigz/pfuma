import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { listAwards, listSponsorPayments, listSponsors, sponsorArrears, SPONSOR_TYPE_LABEL, SPONSOR_TYPES } from '@/lib/finance/sponsors';
import { getScopedDb } from '@/lib/scoped-db';
import { enabledCurrencies } from '@/lib/finance/common';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { FormAction } from '@/components/finance/FormAction';
import { METHOD_OPTIONS, Money, MoneyLine, RowAction, Section, StatusBadge, Td, Th } from '@/components/finance/shared';

export const metadata = { title: 'Sponsors · Pfuma' };

export default async function SponsorsPage() {
  const { user, can } = await getAccess();
  if (!can('finance.sponsors.manage') && !can('finance.awards.approve') && !can('finance.accounts.view') && !can('finance.reports.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const manage = can('finance.sponsors.manage');
  const [sponsors, awards, owed, payments, terms, currencies] = await Promise.all([
    listSponsors(user), listAwards(user, {}), sponsorArrears(user).catch(() => []), listSponsorPayments(user).catch(() => []),
    db.academicTerm.findMany({ where: { schoolId: user.schoolId }, orderBy: { startDate: 'desc' }, select: { id: true, name: true } }),
    db.$tx((tx) => enabledCurrencies(tx, user.schoolId)),
  ]);
  const owedBy = new Map(owed.map((o) => [o.sponsorId, o]));
  const curOpts = currencies.map((c) => ({ value: c, label: c === 'USD' ? 'US dollars' : 'ZiG' }));
  const termOpts = terms.map((t) => ({ value: t.id, label: t.name }));
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Sponsors" description="Someone other than the parent who pays: BEAM, a church, an NGO, a company. A sponsor's share is claimed from the sponsor, not the parent, and the school tracks what each sponsor still owes." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Sponsors' }]} />
      <Section title={`${sponsors.length} sponsor${sponsors.length === 1 ? '' : 's'}`} action={manage ? (
        <FormAction label="Add a sponsor" variant="primary" size="md" url="/api/finance/sponsors" done="Sponsor added"
          fields={[
            { name: 'name', label: 'Name', required: true, maxLength: 80 },
            { name: 'type', label: 'Kind', type: 'select', required: true, options: SPONSOR_TYPES.map((t) => ({ value: t, label: SPONSOR_TYPE_LABEL[t] })) },
            { name: 'contactPerson', label: 'Contact person', maxLength: 80 }, { name: 'phone', label: 'Phone', maxLength: 30 }, { name: 'email', label: 'Email', maxLength: 120 }, { name: 'address', label: 'Address', maxLength: 200 },
          ]} />
      ) : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem]">
            <thead><tr><Th>Sponsor</Th><Th>Kind</Th><Th>Learners</Th><Th className="text-right">Owes the school</Th><Th>Oldest unpaid term</Th><Th /></tr></thead>
            <tbody>
              {sponsors.map((s) => {
                const o = owedBy.get(s.id);
                return (
                  <tr key={s.id} className={`border-t border-line align-top ${s.active ? '' : 'text-muted'}`}>
                    <Td>{s.name}{!s.active && ' (off)'}<div className="text-xs text-muted">{[s.contactPerson, s.phone].filter(Boolean).join(' · ')}</div></Td>
                    <Td>{SPONSOR_TYPE_LABEL[s.type as keyof typeof SPONSOR_TYPE_LABEL] ?? s.type}</Td><Td>{s.awards}</Td>
                    <Td className="text-right">{o ? <MoneyLine totals={o.owed} /> : '—'}</Td><Td>{o?.oldestUnpaidTerm ?? '—'}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        {manage && s.active && (
                          <FormAction label="Add a learner" size="sm" url="/api/finance/awards" extra={{ sponsorId: s.id }} done="Sent for approval" intro="The Head approves the award before it applies at billing. Leave the fee items empty to cover every fee."
                            fields={[
                              { name: 'studentId', label: 'Learner', type: 'student', required: true },
                              { name: 'percent', label: 'Covers (% of each fee)', type: 'number', hint: 'Give a percentage, or a fixed amount per term below' },
                              { name: 'amount', label: 'Or fixed amount per term', type: 'money' },
                              { name: 'currency', label: 'Currency', type: 'select', required: true, initial: curOpts[0]?.value, options: curOpts },
                              { name: 'termFromId', label: 'From term', type: 'select', options: termOpts, hint: 'Leave empty for the current term' },
                              { name: 'reference', label: 'Sponsor reference', maxLength: 80 },
                            ]} />
                        )}
                        <a className="inline-flex min-h-[36px] items-center text-sm underline" href={`/api/finance/sponsors/${s.id}/claim/export?format=pdf`}>Claim (PDF)</a>
                        {can('finance.reports.export') && <a className="inline-flex min-h-[36px] items-center text-sm underline" href={`/api/finance/sponsors/${s.id}/claim/export?format=xlsx`}>Excel</a>}
                        {manage && <RowAction label={s.active ? 'Switch off' : 'Switch on'} variant="ghost" url={`/api/finance/sponsors/${s.id}`} method="PATCH" body={{ active: !s.active }} done="Saved" />}
                      </div>
                    </Td>
                  </tr>
                );
              })}
              {sponsors.length === 0 && <tr><Td className="text-muted">No sponsors yet.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Awards" hint="Which learners a sponsor covers, and how much. An award starts only when someone else approves it.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[50rem]">
            <thead><tr><Th>Learner</Th><Th>Sponsor</Th><Th>Covers</Th><Th>From</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {awards.map((a) => (
                <tr key={a.id} className="border-t border-line align-top">
                  <Td><Link className="underline" href={`/finance/accounts/${a.studentId}`}>{a.studentName}</Link></Td><Td>{a.sponsorName}{a.reference && <div className="text-xs text-muted">{a.reference}</div>}</Td>
                  <Td>{a.percent !== null ? `${a.percent}%` : a.amountCents !== null ? <Money cents={a.amountCents} currency={a.currency} /> : '—'}{a.items.length > 0 && <div className="text-xs text-muted">{a.items.join(', ')}</div>}</Td>
                  <Td>{a.termFrom}{a.termTo ? ` to ${a.termTo}` : ''}</Td>
                  <Td><StatusBadge status={a.status} />{a.cancelReason && <div className="text-xs text-muted">{a.cancelReason}</div>}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      {a.status === 'PENDING' && can('finance.awards.approve') && (a.createdById === user.id ? <span className="max-w-[10rem] text-xs text-muted">You asked for this, so someone else decides.</span> : <>
                        <RowAction label="Approve" variant="primary" url={`/api/finance/awards/${a.id}/decide`} body={{ decision: 'approve' }} done="Approved" />
                        <RowAction label="Reject" variant="danger" url={`/api/finance/awards/${a.id}/decide`} body={{ decision: 'reject' }} reason={{ label: 'Why is it rejected?', min: 3, field: 'note' }} done="Rejected" />
                      </>)}
                      {a.status === 'APPROVED' && (manage || can('finance.awards.approve')) && (
                        <FormAction label="Stop sponsoring" size="sm" variant="danger" url={`/api/finance/awards/${a.id}/cancel`} done="Award cancelled" intro="From the term chosen, any amount the sponsor has not paid goes back to the parent. The parent is told by SMS."
                          fields={[{ name: 'fromTermId', label: 'From term', type: 'select', required: true, options: termOpts }, { name: 'reason', label: 'Why?', type: 'textarea', required: true }]} />
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
              {awards.length === 0 && <tr><Td className="text-muted">No awards yet.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Money from sponsors" hint="Recorded by one person and verified by another, like any payment. A verified payment is shared over the sponsor's unpaid claims, oldest term first."
        action={can('finance.payments.record') ? (
          <FormAction label="Record a sponsor payment" size="md" url="/api/finance/sponsor-payments" done="Recorded. Someone else verifies it."
            fields={[
              { name: 'sponsorId', label: 'Sponsor', type: 'select', required: true, options: sponsors.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name })) },
              { name: 'currency', label: 'Currency', type: 'select', required: true, initial: curOpts[0]?.value, options: curOpts },
              { name: 'amount', label: 'Amount', type: 'money', required: true },
              { name: 'method', label: 'Paid by', type: 'select', required: true, options: METHOD_OPTIONS },
              { name: 'reference', label: 'Reference' }, { name: 'receivedOn', label: 'Date received', type: 'date' },
            ]} />
        ) : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem]">
            <thead><tr><Th>Date</Th><Th>Sponsor</Th><Th className="text-right">Amount</Th><Th>Reference</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <Td>{p.receivedOn}</Td><Td>{p.sponsorName}</Td><Td className="text-right"><Money cents={p.amountCents} currency={p.currency} /></Td><Td>{p.reference ?? p.receiptNumber ?? p.ackNumber}</Td><Td><StatusBadge status={p.voided ? 'VOIDED' : p.status} /></Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      {(p.status === 'PENDING' || p.status === 'RECEIVED') && can('finance.payments.verify') && (p.recordedById === user.id ? <span className="max-w-[10rem] text-xs text-muted">You recorded this.</span> : <>
                        <RowAction label="Verify" variant="primary" url={`/api/finance/sponsor-payments/${p.id}/verify`} done="Verified" />
                        <RowAction label="Reject" variant="danger" url={`/api/finance/sponsor-payments/${p.id}/reject`} reason={{ label: 'Why is it rejected?', min: 3 }} done="Rejected" />
                      </>)}
                      {p.status === 'VERIFIED' && !p.voided && can('finance.payments.void') && <RowAction label="Void" variant="ghost" url={`/api/finance/sponsor-payments/${p.id}/void`} reason={{ label: 'Why is it voided?', min: 5 }} done="Voided" />}
                    </div>
                  </Td>
                </tr>
              ))}
              {payments.length === 0 && <tr><Td className="text-muted">No sponsor payments yet.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

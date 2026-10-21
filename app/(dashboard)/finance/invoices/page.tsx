import { getAccess } from '@/lib/access';
import { listInvoices } from '@/lib/finance/invoices';
import { getScopedDb } from '@/lib/scoped-db';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { FormAction } from '@/components/finance/FormAction';
import { RowAction, Section, Td, Th } from '@/components/finance/shared';

export const metadata = { title: 'Invoices · Pfuma' };

export default async function InvoicesPage({ searchParams }: { searchParams: { termId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('finance.statements.view') && !can('finance.accounts.view') && !can('finance.billing.run')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const [invoices, terms, classes] = await Promise.all([
    listInvoices(user, { termId: searchParams.termId || undefined }),
    db.academicTerm.findMany({ where: { schoolId: user.schoolId }, orderBy: { startDate: 'desc' }, select: { id: true, name: true, status: true } }),
    db.schoolClass.findMany({ where: { schoolId: user.schoolId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const open = terms.find((t) => t.status === 'OPEN') ?? terms[0];
  const termOpts = terms.map((t) => ({ value: t.id, label: t.name }));
  const termName = new Map(terms.map((t) => [t.id, t.name]));
  const make = can('finance.billing.run');
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Invoices" description="A fee statement for a learner or a whole family, numbered in the school's invoice format. The figures are kept as they were on the day it was raised. Raising one changes no balance."
        breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Invoices' }]}
        actions={make ? (
          <div className="flex flex-wrap gap-2">
            <FormAction label="Invoice a learner" variant="primary" size="md" url="/api/finance/invoices" done="Invoice raised"
              fields={[{ name: 'studentId', label: 'Learner', type: 'student', required: true }, { name: 'termId', label: 'Term', type: 'select', required: true, initial: open?.id, options: termOpts }]} />
            <FormAction label="Invoice a class" variant="secondary" size="md" url="/api/finance/invoices" done="Invoices raised" intro="Raises one invoice for each learner in the class."
              fields={[{ name: 'classId', label: 'Class', type: 'select', required: true, options: classes.map((c) => ({ value: c.id, label: c.name })) }, { name: 'termId', label: 'Term', type: 'select', required: true, initial: open?.id, options: termOpts }]} />
          </div>
        ) : undefined} />
      <Section title={`${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem]">
            <thead><tr><Th>Number</Th><Th>Term</Th><Th>Raised</Th><Th /></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-t border-line">
                  <Td className="font-semibold">{i.number}</Td><Td>{termName.get(i.termId) ?? ''}</Td><Td>{i.createdAt.slice(0, 10)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-3">
                      <a className="text-sm underline" href={`/api/finance/invoices/${i.id}/pdf`}>PDF</a>
                      {can('finance.statements.view') && <RowAction label="Text the fee payer" variant="ghost" url={`/api/finance/invoices/${i.id}/sms`} done="Queued" />}
                    </div>
                  </Td>
                </tr>
              ))}
              {invoices.length === 0 && <tr><Td className="text-muted">No invoices yet.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

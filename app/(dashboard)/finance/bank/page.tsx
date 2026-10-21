import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { listBanks, listStatements } from '@/lib/finance/bank';
import { enabledCurrencies } from '@/lib/finance/common';
import { getScopedDb } from '@/lib/scoped-db';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { BankUpload } from '@/components/finance/BankUpload';
import { Section, Td, Th } from '@/components/finance/shared';

export const metadata = { title: 'Bank reconciliation · Pfuma' };

export default async function BankPage() {
  const { user, can } = await getAccess();
  if (!can('finance.bank.reconcile')) return <AccessDenied />;
  const [statements, banks, currencies] = await Promise.all([listStatements(user), listBanks(user), getScopedDb(user.schoolId, user.id).$tx((tx) => enabledCurrencies(tx, user.schoolId))]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Bank reconciliation" description="Upload the bank or EcoCash statement and check it against the payments in the system. Lines are matched by reference and amount, then by amount within three days. Nothing is changed until you act on a line."
        breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Bank reconciliation' }]} actions={<BankUpload banks={banks.map((b) => b.bank)} currencies={currencies} />} />
      <Section title="Statements">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem]">
            <thead><tr><Th>Account</Th><Th>Period</Th><Th className="text-right">Lines</Th><Th className="text-right">Matched</Th><Th className="text-right">Not matched</Th><Th /></tr></thead>
            <tbody>
              {statements.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <Td>{s.account} <span className="text-xs text-muted">{s.currency}</span><div className="text-xs text-muted">{s.fileName}</div></Td><Td>{s.from} to {s.to}</Td>
                  <Td className="text-right">{s.lines}</Td><Td className="text-right">{s.matched}</Td><Td className="text-right">{s.unmatched}</Td>
                  <Td><Link className="text-sm underline" href={`/finance/bank/${s.id}`}>Open</Link></Td>
                </tr>
              ))}
              {statements.length === 0 && <tr><Td className="text-muted">No statements uploaded yet.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

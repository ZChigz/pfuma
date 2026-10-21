// The Finance tab on a student's profile. People who can see accounts get the balance per currency, any payment plan and the recent payments;
// a class teacher (who may only see "fees outstanding") gets a single yes or no with no amounts. Imported for its side effect by the profile page.
import Link from 'next/link';
import { registerStudentTab } from '@/lib/students/rules';
import { registerStudentTabContent } from '@/components/students/tab-registry';
import { getScopedDb } from '@/lib/scoped-db';
import { can } from '@/lib/access-core';
import { studentAccount } from '@/lib/finance/balances';
import { feesOutstandingFor } from '@/lib/finance/statements';
import { planStatusByStudent } from '@/lib/finance/plans';
import { CURRENCIES, formatMoney } from '@/lib/finance/money';
import { ymd } from '@/lib/finance/common';

registerStudentTab({ key: 'finance', label: 'Fees', permission: 'finance.accounts.view', alsoFor: ['finance.arrears.flag', 'finance.statements.view'] });

registerStudentTabContent('finance', async ({ studentId, user }) => {
  const db = getScopedDb(user.schoolId, user.id);
  if (!can(user, 'finance.accounts.view') && !can(user, 'finance.statements.view')) {
    const owing = await db.$tx((tx) => feesOutstandingFor(tx, user.schoolId, [studentId]));
    return (
      <section className="rounded-2xl bg-white p-4">
        <h2 className="text-base font-semibold text-ink">Fees</h2>
        <p className="mt-2 text-sm text-ink">{owing.has(studentId) ? 'Fees are outstanding for this learner.' : 'No fees are outstanding.'}</p>
        <p className="mt-1 text-xs text-muted">Amounts are kept with the bursar.</p>
      </section>
    );
  }
  const { acct, plan, payments } = await db.$tx(async (tx) => ({
    acct: await studentAccount(tx, user.schoolId, studentId),
    plan: (await planStatusByStudent(tx, user.schoolId, [studentId])).get(studentId) ?? null,
    payments: await tx.finPayment.findMany({ where: { schoolId: user.schoolId, studentId, status: 'VERIFIED', voidRow: null }, orderBy: { receivedOn: 'desc' }, take: 5, select: { id: true, receiptNumber: true, ackNumber: true, receivedOn: true, currency: true, amountCents: true } }),
  }));
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">Fees</h2>
        <div className="flex gap-3 text-sm">
          <Link className="font-semibold text-primary underline" href={`/finance/accounts/${studentId}`}>Open the account</Link>
          <a className="font-semibold text-primary underline" href={`/api/finance/statements/student/${studentId}/pdf`}>Statement (PDF)</a>
        </div>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {CURRENCIES.map((c) => (
          <div key={c}><dt className="text-muted">{c === 'USD' ? 'US dollars' : 'ZiG'}</dt><dd className="font-semibold tabular-nums text-ink">{acct.byCurrency[c].outstanding > 0 ? `Owes ${formatMoney(acct.byCurrency[c].outstanding, c)}` : acct.byCurrency[c].credit > 0 ? `Credit ${formatMoney(acct.byCurrency[c].credit, c)}` : 'Nothing owed'}</dd></div>
        ))}
      </dl>
      {plan && <p className="text-sm text-ink">{plan === 'ON_PLAN' ? 'On a payment plan, up to date.' : 'On a payment plan with a missed instalment.'}</p>}
      {payments.length > 0 && (
        <ul className="text-sm text-ink">{payments.map((p) => <li key={p.id}><Link className="underline" href={`/finance/payments/${p.id}/receipt`}>{p.receiptNumber ?? p.ackNumber}</Link> · {ymd(p.receivedOn)} · {formatMoney(p.amountCents, p.currency)}</li>)}</ul>
      )}
    </section>
  );
});

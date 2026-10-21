import { getAccess } from '@/lib/access';
import { cashUpDay, myCashUp } from '@/lib/finance/cashup';
import { todayInHarare } from '@/lib/finance/common';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { FormAction } from '@/components/finance/FormAction';
import { MoneyLine, Notice, RowAction, Section, StatusBadge, Td, Th } from '@/components/finance/shared';

export const metadata = { title: 'Daily cash-up · Pfuma' };

export default async function CashUpPage({ searchParams }: { searchParams: { date?: string } }) {
  const { user, can } = await getAccess();
  const submit = can('finance.cashup.submit'); const confirm = can('finance.cashup.confirm'); const signoff = can('finance.cashup.signoff');
  if (!submit && !confirm && !signoff) return <AccessDenied />;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : todayInHarare();
  const [mine, day] = await Promise.all([
    submit ? myCashUp(user, date) : Promise.resolve(null),
    confirm || signoff ? cashUpDay(user, date) : Promise.resolve(null),
  ]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Daily cash-up" description="Each person who takes money counts the drawer at the end of the day. The bursar confirms the cash, which makes those payments verified, and banks it. The Head signs the day off." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Cash-up' }]} />
      <form className="flex items-end gap-2" action="/finance/cash-up">
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">Day<input type="date" name="date" defaultValue={date} className="h-11 rounded-xl border border-line bg-white px-3 text-sm" /></label>
        <button className="inline-flex min-h-[44px] items-center rounded-full bg-primary px-5 text-sm font-semibold text-white">Show</button>
      </form>
      {mine && (
        <Section title={`Your cash for ${date}`} action={mine.status === 'OPEN' ? (
          <FormAction label="Count and submit" variant="primary" size="md" url="/api/finance/cash-up/submit" extra={{ date }} done="Cash-up submitted"
            intro={`The system expects US$ ${(mine.expected.USD / 100).toFixed(2)} and ZiG ${(mine.expected.ZIG / 100).toFixed(2)} in your drawer. Count it and enter what you have. If it is out, write down why.`}
            fields={[{ name: 'countedUsd', label: 'Counted, US dollars', type: 'money', required: true }, { name: 'countedZig', label: 'Counted, ZiG', type: 'money' }, { name: 'explanation', label: 'If different, why?', type: 'textarea' }]} />
        ) : <StatusBadge status={mine.status} />}>
          {mine.explanation && mine.status === 'OPEN' && <Notice tone="warn">{mine.explanation}</Notice>}
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <p><span className="text-muted">Expected: </span><MoneyLine totals={mine.expected} empty="Nothing" /></p>
            <p><span className="text-muted">Counted: </span><MoneyLine totals={mine.counted} empty="Not yet" /></p>
            <p><span className="text-muted">Difference: </span><MoneyLine totals={mine.difference} empty="None" /></p>
          </div>
          <p className="mt-2 text-xs text-muted">Cash refunds paid out: <MoneyLine totals={mine.position.cashRefunds} empty="none" /> · petty cash paid out: <MoneyLine totals={mine.position.petty} empty="none" /> · {mine.position.electronic.count} electronic payment(s) are not cash and are not counted here.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[30rem]">
              <thead><tr><Th>Receipt</Th><Th>Learner</Th><Th className="text-right">Cash</Th><Th>Status</Th></tr></thead>
              <tbody>
                {mine.position.cashPayments.map((p) => <tr key={p.id} className="border-t border-line"><Td>{p.ref}</Td><Td>{p.student}</Td><Td className="text-right"><MoneyLine totals={{ [p.currency]: p.cents }} />{p.zigCents ? <span className="text-xs text-muted"> (ZiG {(p.zigCents / 100).toFixed(2)} received)</span> : null}</Td><Td><StatusBadge status={p.status} /></Td></tr>)}
                {mine.position.cashPayments.length === 0 && <tr><Td className="text-muted">No cash payments recorded by you on this day.</Td></tr>}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      {day && (
        <Section title={`Everyone on ${day.date}`} hint="Cash counted by each person who took payments, and where their cash-up stands.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem]">
              <thead><tr><Th>Person</Th><Th>Status</Th><Th className="text-right">Expected</Th><Th className="text-right">Counted</Th><Th className="text-right">Difference</Th><Th /></tr></thead>
              <tbody>
                {day.clerks.map((c) => (
                  <tr key={c.userId} className="border-t border-line align-top">
                    <Td>{c.clerk}</Td><Td>{c.status}{c.raw === 'CONFIRMED' && <span className="text-xs text-muted"> · confirmed, waiting for the Head</span>}</Td>
                    <Td className="text-right"><MoneyLine totals={c.expected} empty="—" /></Td><Td className="text-right"><MoneyLine totals={c.counted} empty="—" /></Td><Td className="text-right"><MoneyLine totals={c.difference} empty="—" /></Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        {c.cashUpId && c.raw === 'SUBMITTED' && confirm && (c.userId === user.id ? <span className="max-w-[10rem] text-xs text-muted">You counted this, so someone else confirms it.</span> : <>
                          <FormAction label="Confirm and bank" size="sm" variant="primary" url={`/api/finance/cash-up/${c.cashUpId}/confirm`} done="Confirmed. Those payments are now verified." intro="Confirming makes this person’s cash payments of the day verified. Enter the bank deposit slip number when you have banked the cash." fields={[{ name: 'depositRef', label: 'Deposit slip number', maxLength: 60 }]} />
                          <RowAction label="Send back" variant="ghost" url={`/api/finance/cash-up/${c.cashUpId}/return`} reason={{ label: 'What should be recounted?', min: 5 }} done="Sent back" />
                        </>)}
                        {c.cashUpId && c.raw === 'CONFIRMED' && signoff && (c.userId === user.id ? <span className="max-w-[10rem] text-xs text-muted">You counted this cash.</span> : <RowAction label="Sign off the day" variant="primary" url={`/api/finance/cash-up/${c.cashUpId}/sign-off`} done="Signed off" />)}
                      </div>
                    </Td>
                  </tr>
                ))}
                {day.clerks.length === 0 && <tr><Td className="text-muted">Nobody took payments on this day.</Td></tr>}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

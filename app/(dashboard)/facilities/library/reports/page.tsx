import { getAccess } from '@/lib/access';
import { libraryReports } from '@/lib/facilities/library';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { RowAction, Section, Td, Th } from '@/components/finance/shared';
import { LibraryNav } from '@/components/facilities/LibraryNav';

export const metadata = { title: 'Library reports · Pfuma' };
const money = (c: number, cur: string) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;

export default async function LibraryReportsPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const { user, can } = await getAccess();
  const any = ['view', 'manage', 'desk', 'waive'].some((k) => can(`facilities.library.${k}` as never)) || can('facilities.textbooks.issue');
  if (!any) return <AccessDenied />;
  const r = await libraryReports(user, { from: searchParams.from, to: searchParams.to });
  const overdue = r.out.filter((o) => o.overdueDays > 0);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Library reports" description={`From ${r.from} to ${r.to}. Dollars and ZiG are never added together.`}
        actions={(can('facilities.library.desk') || can('facilities.library.manage')) && overdue.length > 0 && <RowAction label={`Send ${overdue.length} overdue reminders`} variant="primary" url="/api/facilities/library/reminders" done="Reminders queued" confirm="Each learner's guardian gets a text message (once a day per book), and staff members get a notification." />} />
      <LibraryNav can={can} current="/facilities/library/reports" />
      <form className="flex flex-wrap items-end gap-2" action="/facilities/library/reports">
        <label className="text-sm font-medium text-ink">From<input type="date" name="from" defaultValue={r.from} className="mt-1 block h-11 rounded-xl border border-line bg-white px-3 text-sm" /></label>
        <label className="text-sm font-medium text-ink">To<input type="date" name="to" defaultValue={r.to} className="mt-1 block h-11 rounded-xl border border-line bg-white px-3 text-sm" /></label>
        <button className="min-h-[44px] rounded-full bg-primary px-5 text-sm font-semibold text-white">Show</button>
      </form>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {([['Copies', r.counts.total], ['On the shelf', r.counts.available], ['Out', r.counts.onLoan], ['Overdue', overdue.length], ['Reserved', r.counts.reserved], ['Lost', r.counts.lost]] as const).map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-white p-3"><p className="text-xs text-muted">{k}</p><p className="text-2xl font-semibold text-ink">{v}</p></div>
        ))}
      </div>
      <Section title="Books out" hint="Overdue first.">
        {r.out.length === 0 ? <p className="text-sm text-muted">Nothing is out.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[34rem]"><thead><tr><Th>Member</Th><Th>Class</Th><Th>Book</Th><Th>Due</Th><Th /></tr></thead><tbody>
            {[...r.out].sort((a, b) => b.overdueDays - a.overdueDays).map((o) => (
              <tr key={o.loanId} className="border-t border-line"><Td>{o.member}</Td><Td>{o.group}</Td><Td>{o.title} <span className="font-mono text-xs text-muted">{o.accessionNo}</span></Td><Td>{o.dueAt}</Td><Td>{o.overdueDays > 0 && <Badge variant="danger" label={`${o.overdueDays} days late`} />}</Td></tr>
            ))}
          </tbody></table></div>
        )}
      </Section>
      <Section title="Fines" hint="A fine can be waived with a reason. A fine that is already charged in Finance is voided for you.">
        {r.fines.length === 0 ? <p className="text-sm text-muted">No fines in this period.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[36rem]"><thead><tr><Th>Member</Th><Th>Book</Th><Th>Returned</Th><Th className="text-right">Fine</Th><Th>Kept in</Th><Th /></tr></thead><tbody>
            {r.fines.map((f) => (
              <tr key={f.loanId} className="border-t border-line"><Td>{f.member}</Td><Td>{f.title}</Td><Td>{f.returnedAt}</Td><Td className="text-right">{money(f.fineCents, f.currency)}</Td><Td>{f.charged}</Td>
                <Td>{f.waived ? <span className="text-xs text-muted">Waived: {f.waiveReason}</span> : can('facilities.library.waive') && <RowAction label="Waive" variant="ghost" url={`/api/facilities/library/loans/${f.loanId}/waive`} reason={{ label: 'Why is the fine waived?', min: 3 }} done="Fine waived" />}</Td></tr>
            ))}
          </tbody></table></div>
        )}
      </Section>
      <Section title="Most borrowed"><div className="overflow-x-auto"><table className="w-full min-w-[20rem]"><thead><tr><Th>Title</Th><Th className="text-right">Loans</Th></tr></thead><tbody>
        {r.mostBorrowed.length === 0 ? <tr><Td>No loans in this period.</Td><Td /></tr> : r.mostBorrowed.map((m) => <tr key={m.title} className="border-t border-line"><Td>{m.title}</Td><Td className="text-right">{m.loans}</Td></tr>)}
      </tbody></table></div></Section>
      <Section title="Textbooks held per class"><div className="overflow-x-auto"><table className="w-full min-w-[20rem]"><thead><tr><Th>Class</Th><Th className="text-right">Books held</Th></tr></thead><tbody>
        {r.textbooksByClass.length === 0 ? <tr><Td>No textbooks are issued.</Td><Td /></tr> : r.textbooksByClass.map((m) => <tr key={m.class} className="border-t border-line"><Td>{m.class}</Td><Td className="text-right">{m.books}</Td></tr>)}
      </tbody></table></div></Section>
      <Section title="Lost books" hint={`Value at cost: ${money(r.lostValue.USD, 'USD')} and ${money(r.lostValue.ZIG, 'ZIG')}.`}><div className="overflow-x-auto"><table className="w-full min-w-[24rem]"><thead><tr><Th>Copy</Th><Th>Title</Th><Th className="text-right">Cost</Th></tr></thead><tbody>
        {r.lost.length === 0 ? <tr><Td>No lost books.</Td><Td /><Td /></tr> : r.lost.map((l) => <tr key={l.accessionNo} className="border-t border-line"><Td className="font-mono">{l.accessionNo}</Td><Td>{l.title}</Td><Td className="text-right">{l.costCents ? money(l.costCents, l.currency) : '—'}</Td></tr>)}
      </tbody></table></div></Section>
    </div>
  );
}

import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { classIssueSheet, listTextbookSets, listTitles } from '@/lib/facilities/library';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Notice, Section, Td, Th } from '@/components/finance/shared';
import { LibraryNav } from '@/components/facilities/LibraryNav';
import { CollectBooks, IssueBooks, MarkMissing } from '@/components/facilities/TextbookDesk';

export const metadata = { title: 'Textbooks · Pfuma' };

export default async function TextbooksPage({ searchParams }: { searchParams: { classId?: string; setId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('facilities.textbooks.issue') && !can('facilities.library.manage') && !can('facilities.library.view')) return <AccessDenied />;
  const issue = can('facilities.textbooks.issue');
  const db = getScopedDb(user.schoolId, user.id);
  const [classes, sets, titles] = await Promise.all([
    db.schoolClass.findMany({ where: { active: true }, orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }], select: { id: true, name: true } }),
    listTextbookSets(user),
    can('facilities.library.manage') || issue ? listTitles(user, { category: 'TEXTBOOK' }) : Promise.resolve({ rows: [], total: 0 }),
  ]);
  const sheet = searchParams.classId ? await classIssueSheet(user, searchParams.classId, searchParams.setId || undefined).catch(() => null) : null;
  const set = sets.find((s) => s.id === searchParams.setId);
  const setTitles = set ? set.items.map((i) => i.title) : [];

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Textbook issue" description="Give each learner their book set at the start of the year by scanning each copy; scan them back at the end or when the learner leaves."
        actions={(can('facilities.library.manage') || issue) && (
          <FormAction label="New book set" size="md" url="/api/facilities/textbooks/sets" done="Set saved" intro="A set is the books a learner gets together, for example Form 3 sciences."
            fields={[{ name: 'name', label: 'Set name', required: true },
              ...[0, 1, 2, 3].map((n) => ({ name: `title${n}`, label: `Book ${n + 1}${n === 0 ? '' : ' (optional)'}`, type: 'select' as const, required: n === 0, options: titles.rows.map((t) => ({ value: t.id, label: t.title })) }))]} />
        )} />
      <LibraryNav can={can} current="/facilities/library/textbooks" />
      <form action="/facilities/library/textbooks" className="flex flex-wrap gap-2">
        <select name="classId" defaultValue={searchParams.classId ?? ''} className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-sm"><option value="">Choose a class</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select name="setId" defaultValue={searchParams.setId ?? ''} className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-sm"><option value="">Any book</option>{sets.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <button className="min-h-[44px] rounded-full bg-primary px-5 text-sm font-semibold text-white">Show</button>
      </form>
      {issue && <Section title="Collect books" hint="Scan books as they come back."><CollectBooks /></Section>}
      {!sheet ? <Notice tone="info">Choose a class to see who holds which books.</Notice> : (
        <Section title={`${sheet.class.name}${set ? ` · ${set.name}` : ''}`} hint={setTitles.length ? `The set: ${setTitles.join(', ')}` : undefined}>
          {sheet.students.length === 0 ? <p className="text-sm text-muted">No learners in this class.</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[36rem]"><thead><tr><Th>Learner</Th><Th>Books held</Th><Th /></tr></thead><tbody>
              {sheet.students.map((s) => {
                const held = s.books.filter((b) => !b.missing);
                const have = new Set(s.books.map((b) => b.title));
                const lacking = setTitles.filter((t) => !have.has(t));
                return (
                  <tr key={s.id} className="border-t border-line align-top">
                    <Td>{s.fullName}<div className="text-xs text-muted">{s.admissionNumber}</div></Td>
                    <Td>{s.books.length === 0 ? <span className="text-muted">None</span> : s.books.map((b) => <div key={b.issueId} className="text-sm">{b.title} <span className="font-mono text-xs text-muted">{b.accessionNo}</span>{b.missing && <> <Badge variant="danger" label="Missing" /></>}</div>)}
                      {set && lacking.length > 0 && <p className="mt-1 text-xs font-semibold text-muted">Still needs: {lacking.join(', ')}</p>}</Td>
                    <Td>{issue && <div className="flex flex-col gap-2"><IssueBooks studentId={s.id} name={s.fullName} setId={set?.id} />{held.length > 0 && <MarkMissing studentId={s.id} name={s.fullName} count={held.length} />}</div>}</Td>
                  </tr>
                );
              })}
            </tbody></table></div>
          )}
        </Section>
      )}
    </div>
  );
}

import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { CATEGORIES, listTitles } from '@/lib/facilities/library';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Section, Td, Th } from '@/components/finance/shared';
import { LibraryNav } from '@/components/facilities/LibraryNav';

export const metadata = { title: 'Library · Pfuma' };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export default async function LibraryPage({ searchParams }: { searchParams: { q?: string; category?: string; page?: string } }) {
  const { user, can } = await getAccess();
  const any = ['view', 'manage', 'desk', 'waive'].some((k) => can(`facilities.library.${k}` as never)) || can('facilities.textbooks.issue');
  if (!any) return <AccessDenied />;
  const page = Math.max(1, Number(searchParams.page) || 1);
  const { rows, total } = await listTitles(user, { q: searchParams.q, category: searchParams.category, page });
  const q = (p: number) => `/facilities/library?${new URLSearchParams({ ...(searchParams.q ? { q: searchParams.q } : {}), ...(searchParams.category ? { category: searchParams.category } : {}), page: String(p) })}`;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Library" description="The catalogue. The number of copies is always counted from the copies themselves."
        actions={can('facilities.library.manage') && (
          <FormAction label="Add a title" size="md" variant="primary" url="/api/facilities/library/titles" done="Title added"
            fields={[{ name: 'title', label: 'Title', required: true }, { name: 'author', label: 'Author' }, { name: 'isbn', label: 'ISBN' }, { name: 'publisher', label: 'Publisher' }, { name: 'year', label: 'Year', type: 'number' },
              { name: 'edition', label: 'Edition' }, { name: 'subject', label: 'Subject' }, { name: 'level', label: 'Level (for example Form 3)' },
              { name: 'category', label: 'Category', type: 'select', required: true, initial: 'FICTION', options: CATEGORIES.map((c) => ({ value: c, label: label(c) })) },
              { name: 'shelfLocation', label: 'Shelf' }, { name: 'replacementCents', label: 'Replacement cost if lost', type: 'cents' },
              { name: 'currency', label: 'Currency of that cost', type: 'select', options: [{ value: 'USD', label: 'US dollars' }, { value: 'ZIG', label: 'ZiG' }] }]}
            intro="Reference books are not lent out. After adding the title, add its copies to get accession numbers and barcode labels." />
        )} />
      <LibraryNav can={can} current="/facilities/library" />
      <form action="/facilities/library" className="flex flex-wrap gap-2">
        <input name="q" defaultValue={searchParams.q} placeholder="Search title, author, ISBN or subject" className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-sm" />
        <select name="category" defaultValue={searchParams.category ?? ''} className="h-11 rounded-xl border border-line bg-white px-3 text-sm"><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select>
        <button className="min-h-[44px] rounded-full bg-primary px-5 text-sm font-semibold text-white">Search</button>
      </form>
      <Section title={`${total} title${total === 1 ? '' : 's'}`}>
        {rows.length === 0 ? <p className="text-sm text-muted">No titles yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[40rem]"><thead><tr><Th>Title</Th><Th>Author</Th><Th>Category</Th><Th>Shelf</Th><Th className="text-right">Copies</Th><Th className="text-right">On the shelf</Th><Th /></tr></thead><tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-line">
                <Td><Link className="font-semibold text-primary underline" href={`/facilities/library/titles/${t.id}`}>{t.title}</Link>{t.level && <span className="text-xs text-muted"> · {t.level}</span>}</Td>
                <Td>{t.authors.join(', ') || '—'}</Td><Td>{label(t.category)}</Td><Td>{t.shelfLocation ?? '—'}</Td>
                <Td className="text-right">{t.counts.total}</Td><Td className="text-right">{t.counts.available}</Td>
                <Td>{!t.lendable && <Badge variant="neutral" label="Reference" />} {t.counts.lost > 0 && <Badge variant="danger" label={`${t.counts.lost} lost`} />}</Td>
              </tr>
            ))}
          </tbody></table></div>
        )}
        <div className="mt-3 flex gap-3 text-sm">
          {page > 1 && <Link className="font-semibold text-primary underline" href={q(page - 1)}>Previous</Link>}
          {page * 40 < total && <Link className="font-semibold text-primary underline" href={q(page + 1)}>Next</Link>}
        </div>
      </Section>
    </div>
  );
}

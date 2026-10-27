import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { listStocktakes } from '@/lib/facilities/library';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Section, Td, Th } from '@/components/finance/shared';
import { LibraryNav } from '@/components/facilities/LibraryNav';

export const metadata = { title: 'Library stocktake · Pfuma' };

export default async function StocktakePage() {
  const { user, can } = await getAccess();
  if (!can('facilities.library.manage')) return <AccessDenied />;
  const rows = await listStocktakes(user);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Library stocktake" description="Scan the books on the shelves. The system lists the copies that should be there but were not scanned."
        actions={<FormAction label="Start a stocktake" size="md" variant="primary" url="/api/facilities/library/stocktakes" done="Stocktake started"
          fields={[{ name: 'name', label: 'Name', required: true, initial: `Stocktake ${new Date().getFullYear()}` }, { name: 'shelf', label: 'Only this shelf (optional)', hint: 'Leave empty to count the whole library.' }]} />} />
      <LibraryNav can={can} current="/facilities/library/stocktake" />
      <Section title="Stocktakes">
        {rows.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[26rem]"><thead><tr><Th>Name</Th><Th>Shelf</Th><Th>Started</Th><Th>Status</Th><Th /></tr></thead><tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-line"><Td>{s.name}</Td><Td>{s.shelf ?? 'Whole library'}</Td><Td>{s.startedAt.slice(0, 10)}</Td>
                <Td><Badge variant={s.closed ? 'neutral' : 'warning'} label={s.closed ? 'Finished' : 'Counting'} /></Td>
                <Td><Link className="inline-flex min-h-[44px] items-center font-semibold text-primary underline" href={`/facilities/library/stocktake/${s.id}`}>{s.closed ? 'Result' : 'Scan'}</Link></Td></tr>
            ))}
          </tbody></table></div>
        )}
      </Section>
    </div>
  );
}

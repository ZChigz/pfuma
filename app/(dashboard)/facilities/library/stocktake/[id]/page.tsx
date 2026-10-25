import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { stocktakeResult } from '@/lib/facilities/library';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Notice, Section, Td, Th } from '@/components/finance/shared';
import { LibraryNav } from '@/components/facilities/LibraryNav';
import { StocktakeClient } from '@/components/facilities/StocktakeClient';

export const metadata = { title: 'Stocktake · Library · Pfuma' };

export default async function StocktakeSheet({ params }: { params: { id: string } }) {
  const { user, can } = await getAccess();
  if (!can('facilities.library.manage')) return <AccessDenied />;
  const r = await stocktakeResult(user, params.id).catch((e) => { if (e instanceof ServiceError && e.status === 404) return null; throw e; });
  if (!r) notFound();
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title={r.name} description={r.shelf ? `Shelf ${r.shelf}` : 'Whole library'} breadcrumbs={[{ label: 'Stocktake', href: '/facilities/library/stocktake' }, { label: r.name }]} />
      <LibraryNav can={can} current="/facilities/library/stocktake" />
      <StocktakeClient id={r.id} closed={r.closed} scanned={r.scanned} />
      <Section title={r.closed ? 'Not found on the shelf' : 'Not scanned yet'} hint={`${r.scanned} scanned of ${r.expected} copies that should be on the shelf.`}>
        {r.notScanned.length === 0 ? <Notice tone="success">Every copy that should be on the shelf has been scanned.</Notice> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[24rem]"><thead><tr><Th>Accession no.</Th><Th>Title</Th><Th>Shelf</Th></tr></thead><tbody>
            {r.notScanned.map((c) => <tr key={c.copyId} className="border-t border-line"><Td className="font-mono">{c.accessionNo}</Td><Td>{c.title}</Td><Td>{c.shelf ?? '—'}</Td></tr>)}
          </tbody></table></div>
        )}
      </Section>
    </div>
  );
}

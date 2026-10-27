import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getTitle, CONDITIONS } from '@/lib/facilities/library';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { RowAction, Section, Td, Th } from '@/components/finance/shared';
import { LibraryNav } from '@/components/facilities/LibraryNav';

export const metadata = { title: 'Title · Library · Pfuma' };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const money = (c: number, cur: string) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;
const STATUS: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = { AVAILABLE: 'success', ON_LOAN: 'warning', RESERVED: 'warning', LOST: 'danger', WITHDRAWN: 'neutral' };

export default async function TitlePage({ params }: { params: { id: string } }) {
  const { user, can } = await getAccess();
  const any = ['view', 'manage', 'desk', 'waive'].some((k) => can(`facilities.library.${k}` as never)) || can('facilities.textbooks.issue');
  if (!any) return <AccessDenied />;
  const data = await getTitle(user, params.id).catch((e) => { if (e instanceof ServiceError && e.status === 404) return null; throw e; });
  if (!data) notFound();
  const { title: t, copies, counts, reservations } = data;
  const manage = can('facilities.library.manage');
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title={t.title} description={[t.authors.join(', '), t.publisher, t.year, t.edition, t.isbn && `ISBN ${t.isbn}`].filter(Boolean).join(' · ')} breadcrumbs={[{ label: 'Library', href: '/facilities/library' }, { label: t.title }]}
        actions={manage && (
          <div className="flex flex-wrap gap-2">
            <FormAction label="Add copies" size="md" variant="primary" url="/api/facilities/library/copies" done="Copies added" extra={{ titleId: t.id }}
              fields={[{ name: 'count', label: 'How many copies', type: 'number', required: true, initial: '1' }, { name: 'condition', label: 'Condition', type: 'select', initial: 'NEW', options: CONDITIONS.map((c) => ({ value: c, label: label(c) })) },
                { name: 'source', label: 'Where from', type: 'select', initial: 'BOUGHT', options: [{ value: 'BOUGHT', label: 'Bought' }, { value: 'DONATED', label: 'Donated' }] },
                { name: 'costCents', label: 'Cost of each copy', type: 'cents' }, { name: 'currency', label: 'Currency', type: 'select', initial: 'USD', options: [{ value: 'USD', label: 'US dollars' }, { value: 'ZIG', label: 'ZiG' }] }]}
              intro="Each copy gets the next accession number, which is also its barcode." />
            <Link href={`/facilities/library/labels?title=${t.id}`} className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary hover:bg-tint">Print labels</Link>
          </div>
        )} />
      <LibraryNav can={can} current="/facilities/library" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {([['Copies', counts.total], ['On the shelf', counts.available], ['Out', counts.onLoan], ['Reserved', counts.reserved + reservations], ['Lost', counts.lost]] as const).map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-white p-3"><p className="text-xs text-muted">{k}</p><p className="text-2xl font-semibold text-ink">{v}</p></div>
        ))}
      </div>
      <Section title="Copies">
        {copies.length === 0 ? <p className="text-sm text-muted">No copies yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[34rem]"><thead><tr><Th>Accession no.</Th><Th>Condition</Th><Th>Status</Th><Th>Source</Th><Th className="text-right">Cost</Th><Th /></tr></thead><tbody>
            {copies.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <Td className="font-mono">{c.accessionNo}</Td><Td>{label(c.condition)}</Td><Td><Badge variant={STATUS[c.status] ?? 'neutral'} label={label(c.status)} /></Td><Td>{label(c.source)}</Td>
                <Td className="text-right">{c.costCents ? money(c.costCents, c.currency) : '—'}</Td>
                <Td>{manage && c.status === 'AVAILABLE' && (
                  <RowAction label="Withdraw" variant="ghost" url="/api/facilities/library/copies" method="PATCH" body={{ copyId: c.id, withdraw: true }} reason={{ label: 'Why is it taken out of circulation?', min: 3 }} done="Withdrawn" />
                )}</Td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Section>
    </div>
  );
}

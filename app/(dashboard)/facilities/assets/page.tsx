import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { CONDITIONS, listAssets, staffOptions } from '@/lib/facilities/assets';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Section, Td, Th } from '@/components/finance/shared';
import { AssetNav } from '@/components/facilities/AssetNav';

export const metadata = { title: 'Assets · Pfuma' };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const money = (c: number, cur: string) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;

export default async function AssetsPage({ searchParams }: { searchParams: { q?: string; categoryId?: string; location?: string; status?: string; page?: string } }) {
  const { user, can } = await getAccess();
  if (!['view', 'manage', 'maintain', 'dispose', 'verify'].some((k) => can(`facilities.assets.${k}` as never))) return <AccessDenied />;
  const page = Math.max(1, Number(searchParams.page) || 1);
  const [{ rows, total, categories, locations }, people] = await Promise.all([listAssets(user, { ...searchParams, page }), can('facilities.assets.manage') ? staffOptions(user) : Promise.resolve([])]);
  const manage = can('facilities.assets.manage');
  const catOptions = categories.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }));
  const q = (p: number) => `/facilities/assets?${new URLSearchParams({ ...(searchParams.q ? { q: searchParams.q } : {}), ...(searchParams.categoryId ? { categoryId: searchParams.categoryId } : {}), ...(searchParams.location ? { location: searchParams.location } : {}), page: String(p) })}`;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Assets" description="Everything the school owns, each with a tag and a QR label. Cost less depreciation gives the book value."
        actions={manage && (
          <div className="flex flex-wrap gap-2">
            <FormAction label="Register an asset" size="md" variant="primary" url="/api/facilities/assets" done="Asset registered" intro="To add many identical items (120 desks), type how many: each gets its own tag."
              fields={[{ name: 'name', label: 'Name', required: true }, { name: 'count', label: 'How many', type: 'number', initial: '1' }, { name: 'categoryId', label: 'Category', type: 'select', required: true, options: catOptions },
                { name: 'location', label: 'Where it is', required: true }, { name: 'custodianId', label: 'Who looks after it', type: 'select', options: people.map((p) => ({ value: p.id, label: p.name })) },
                { name: 'costCents', label: 'Cost of each', type: 'cents' }, { name: 'currency', label: 'Currency', type: 'select', initial: 'USD', options: [{ value: 'USD', label: 'US dollars' }, { value: 'ZIG', label: 'ZiG' }] },
                { name: 'purchasedAt', label: 'Bought on', type: 'date' }, { name: 'condition', label: 'Condition', type: 'select', initial: 'NEW', options: CONDITIONS.map((c) => ({ value: c, label: label(c) })) },
                { name: 'serial', label: 'Serial number' }, { name: 'warrantyEnd', label: 'Warranty ends', type: 'date' }, { name: 'photoKey', label: 'Photo', type: 'file' }, { name: 'notes', label: 'Notes', type: 'textarea' }]} />
            <Link href="/facilities/assets/register" className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary hover:bg-tint">From a purchase request</Link>
          </div>
        )} />
      <AssetNav can={can} current="/facilities/assets" />
      <form action="/facilities/assets" className="flex flex-wrap gap-2">
        <input name="q" defaultValue={searchParams.q} placeholder="Search name, tag or serial" className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-sm" />
        <select name="categoryId" defaultValue={searchParams.categoryId ?? ''} className="h-11 rounded-xl border border-line bg-white px-3 text-sm"><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select name="location" defaultValue={searchParams.location ?? ''} className="h-11 rounded-xl border border-line bg-white px-3 text-sm"><option value="">All places</option>{locations.map((l) => <option key={l} value={l}>{l}</option>)}</select>
        <select name="status" defaultValue={searchParams.status ?? ''} className="h-11 rounded-xl border border-line bg-white px-3 text-sm"><option value="">In service</option>{['IN_USE', 'IN_STORAGE', 'UNDER_REPAIR', 'LOST', 'DISPOSED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <button className="min-h-[44px] rounded-full bg-primary px-5 text-sm font-semibold text-white">Filter</button>
      </form>
      <Section title={`${total} asset${total === 1 ? '' : 's'}`} action={manage && searchParams.location ? <Link className="text-sm font-semibold text-primary underline" href={`/facilities/assets/labels?location=${encodeURIComponent(searchParams.location)}`}>Print labels for this place</Link> : undefined}>
        {rows.length === 0 ? <p className="text-sm text-muted">Nothing here.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[46rem]"><thead><tr><Th>Tag</Th><Th>Name</Th><Th>Category</Th><Th>Place</Th><Th>Custodian</Th><Th className="text-right">Cost</Th><Th className="text-right">Book value</Th><Th>Status</Th></tr></thead><tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-line">
                <Td className="font-mono"><Link className="font-semibold text-primary underline" href={`/facilities/assets/${a.id}`}>{a.tag}</Link></Td>
                <Td>{a.name}</Td><Td>{a.category}</Td><Td>{a.location}</Td><Td>{a.custodian ?? '—'}</Td>
                <Td className="text-right">{a.costCents ? money(a.costCents, a.currency) : '—'}</Td><Td className="text-right">{a.costCents ? money(a.bookCents, a.currency) : '—'}</Td>
                <Td><Badge variant={a.status === 'IN_USE' ? 'success' : a.status === 'DISPOSED' || a.status === 'LOST' ? 'danger' : 'warning'} label={label(a.status)} /></Td>
              </tr>
            ))}
          </tbody></table></div>
        )}
        <div className="mt-3 flex gap-3 text-sm">{page > 1 && <Link className="font-semibold text-primary underline" href={q(page - 1)}>Previous</Link>}{page * 50 < total && <Link className="font-semibold text-primary underline" href={q(page + 1)}>Next</Link>}</div>
      </Section>
    </div>
  );
}

import QRCode from 'qrcode';
import { getAccess } from '@/lib/access';
import { listAssets } from '@/lib/facilities/assets';
import { labelPayload } from '@/lib/facilities/scan';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { PrintButton } from '@/components/finance/shared';

export const metadata = { title: 'Asset labels · Pfuma' };

/** A sheet of QR labels (tag and name) for the assets of one place or one category, to print and stick on. */
export default async function AssetLabelsPage({ searchParams }: { searchParams: { location?: string; categoryId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('facilities.assets.manage')) return <AccessDenied />;
  const { rows } = await listAssets(user, { location: searchParams.location, categoryId: searchParams.categoryId, status: 'IN_USE', page: 1 });
  const labels = await Promise.all(rows.map(async (a) => ({ id: a.id, tag: a.tag, name: a.name, svg: await QRCode.toString(labelPayload('asset', a.tag), { type: 'svg', margin: 0, width: 96 }) })));
  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="print:hidden"><PageHeader title="Asset labels" description={`${labels.length} labels${searchParams.location ? ` for ${searchParams.location}` : ''}. Print on sticker paper.`} actions={<PrintButton label="Print labels" />} /></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:grid-cols-4">
        {labels.map((l) => (
          <div key={l.id} className="flex break-inside-avoid flex-col items-center gap-1 rounded border border-line bg-white p-2 text-center">
            <div className="h-24 w-24" dangerouslySetInnerHTML={{ __html: l.svg }} />
            <p className="font-mono text-sm font-semibold">{l.tag}</p>
            <p className="line-clamp-2 text-[10px] leading-tight text-muted">{l.name}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

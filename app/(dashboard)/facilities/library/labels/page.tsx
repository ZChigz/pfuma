import QRCode from 'qrcode';
import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getTitle } from '@/lib/facilities/library';
import { labelPayload } from '@/lib/facilities/scan';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { PrintButton } from '@/components/finance/shared';

export const metadata = { title: 'Book labels · Pfuma' };

/** A sheet of QR labels for the copies of one title, to print and stick inside the books. */
export default async function LabelsPage({ searchParams }: { searchParams: { title?: string } }) {
  const { user, can } = await getAccess();
  if (!can('facilities.library.manage')) return <AccessDenied />;
  if (!searchParams.title) notFound();
  const data = await getTitle(user, searchParams.title).catch((e) => { if (e instanceof ServiceError && e.status === 404) return null; throw e; });
  if (!data) notFound();
  const labels = await Promise.all(data.copies.filter((c) => c.status !== 'WITHDRAWN').map(async (c) => ({
    id: c.id, accessionNo: c.accessionNo, svg: await QRCode.toString(labelPayload('copy', c.barcode), { type: 'svg', margin: 0, width: 96 }),
  })));
  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="print:hidden">
        <PageHeader title={`Labels: ${data.title.title}`} description="Print this page on sticker paper. Each label is the copy's accession number and a QR code the phone camera reads." actions={<PrintButton label="Print labels" />} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:grid-cols-4">
        {labels.map((l) => (
          <div key={l.id} className="flex break-inside-avoid flex-col items-center gap-1 rounded border border-line bg-white p-2 text-center">
            <div className="h-24 w-24" dangerouslySetInnerHTML={{ __html: l.svg }} />
            <p className="font-mono text-sm font-semibold">{l.accessionNo}</p>
            <p className="line-clamp-2 text-[10px] leading-tight text-muted">{data.title.title}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

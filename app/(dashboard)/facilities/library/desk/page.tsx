import { getAccess } from '@/lib/access';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { LibraryNav } from '@/components/facilities/LibraryNav';
import { DeskClient } from '@/components/facilities/DeskClient';

export const metadata = { title: 'Library desk · Pfuma' };

export default async function DeskPage() {
  const { can } = await getAccess();
  if (!can('facilities.library.desk') && !can('facilities.library.manage') && !can('facilities.library.view')) return <AccessDenied />;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Library desk" description="Scan the member's ID card, then the book. Returns show the days late and the fine." />
      <LibraryNav can={can} current="/facilities/library/desk" />
      <DeskClient canDesk={can('facilities.library.desk')} canWaive={can('facilities.library.waive')} />
    </div>
  );
}

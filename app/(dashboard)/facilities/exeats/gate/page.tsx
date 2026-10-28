import { getAccess } from '@/lib/access';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { GateClient } from '@/components/facilities/GateClient';

export const metadata = { title: 'Gate · Exeats · Pfuma' };

export default async function GatePage() {
  const { can } = await getAccess();
  if (!can('facilities.exeats.signout') && !can('facilities.exeats.request') && !can('facilities.exeats.approve')) return <AccessDenied />;
  return (
    <div className="flex flex-col gap-3 pb-8">
      <PageHeader title="Gate" description="Scan the learner card. Check who is collecting, then sign out. Sign in when they return." breadcrumbs={[{ label: 'Exeats', href: '/facilities/exeats' }, { label: 'Gate' }]} />
      <GateClient canSign={can('facilities.exeats.signout')} />
    </div>
  );
}

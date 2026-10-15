import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getSchoolProfile } from '@/lib/system/settings';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { SettingsForm } from '@/components/system/SettingsForm';

export const metadata = { title: 'School Settings · Pfuma' };

export default async function SettingsPage() {
  const { user, can } = await getAccess();
  if (!can('system.settings.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const school = await getSchoolProfile(db, user.schoolId);
  if (!school) return <AccessDenied message="School not found." />;

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="School Settings"
        description="Your school's profile and defaults"
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'School Settings' }]}
      />
      <SettingsForm school={school} canUpdate={can('system.settings.update')} />
    </div>
  );
}

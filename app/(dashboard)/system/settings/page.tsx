import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getSchoolProfile } from '@/lib/system/settings';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { DefaultsTab } from '@/components/system/settings/DefaultsTab';
import { ProfileTab } from '@/components/system/settings/ProfileTab';

export const metadata = { title: 'School Settings · Pfuma' };

// More tabs are added here as they are specified; each one is saved and logged on its own.
const TABS = [
  { key: 'profile', label: 'School profile' },
  { key: 'defaults', label: 'Defaults' },
] as const;

export default async function SettingsPage({ searchParams }: { searchParams: { tab?: string | string[] } }) {
  const { user, can } = await getAccess();
  if (!can('system.settings.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const school = await getSchoolProfile(db, user.schoolId);
  if (!school) return <AccessDenied message="School not found." />;

  const wanted = Array.isArray(searchParams.tab) ? searchParams.tab[0] : searchParams.tab;
  const tab = TABS.find((t) => t.key === wanted)?.key ?? 'profile';
  const canUpdate = can('system.settings.update');

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="School Settings"
        description="Everything here is read by the rest of Pfuma, and every change is logged"
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'School Settings' }]}
      />

      <div role="tablist" aria-label="Settings" className="-mx-1 flex gap-1 overflow-x-auto px-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="settings-panel"
            href={`/system/settings?tab=${t.key}`}
            className={`flex min-h-[44px] flex-shrink-0 items-center rounded-full px-4 text-sm font-medium ${tab === t.key ? 'bg-primary text-white' : 'bg-white text-ink hover:bg-tint'}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div id="settings-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'profile' ? <ProfileTab school={school} canUpdate={canUpdate} /> : <DefaultsTab school={school} canUpdate={canUpdate} />}
      </div>
    </div>
  );
}

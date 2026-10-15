import { getAccess } from '@/lib/access';
import { ROLE_LABELS } from '@/lib/role-labels';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProfileForm } from '@/components/system/ProfileForm';

export const metadata = { title: 'My profile · Pfuma' };

export default async function ProfilePage() {
  const { user, can } = await getAccess();
  if (!can('account.profile.view')) return <AccessDenied />;

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader title="My profile" breadcrumbs={[{ label: 'Account' }, { label: 'My profile' }]} />
      <ProfileForm
        fullName={user.fullName}
        email={user.email}
        roleLabel={ROLE_LABELS[user.role] ?? user.role}
        canUpdate={can('account.profile.update')}
        canChangePassword={can('account.password.change')}
      />
    </div>
  );
}

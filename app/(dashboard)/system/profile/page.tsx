import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { STAFF_ROLES } from '@/lib/staff-roles';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProfileForm } from '@/components/system/ProfileForm';

export const metadata = { title: 'My profile · Pfuma' };

export default async function ProfilePage() {
  const { user, can } = await getAccess();
  if (!can('account.profile.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const me = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { fullName: true, phone: true, photoUrl: true } });
  const roles = STAFF_ROLES.filter((r) => user.roles.includes(r.key)).map((r) => ({ key: r.key, name: r.label, description: r.description }));

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader title="My profile" breadcrumbs={[{ label: 'Account' }, { label: 'My profile' }]} />
      <ProfileForm
        fullName={me.fullName}
        email={user.email}
        phone={me.phone ?? ''}
        photoUrl={me.photoUrl}
        roles={roles}
        canUpdate={can('account.profile.update')}
        canChangePassword={can('account.password.change')}
      />
    </div>
  );
}

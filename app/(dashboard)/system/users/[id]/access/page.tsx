import { notFound } from 'next/navigation';
import { getAccess, PERMISSIONS } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { describeAccess } from '@/lib/system/access-admin';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { UserAccessClient, type RoleChoice } from '@/components/system/UserAccessClient';

export const metadata = { title: 'Access · Pfuma' };

const PINS = ['DEPARTMENT', 'CLASS', 'HOSTEL', 'STORE'];

export default async function UserAccessPage({ params }: { params: { id: string } }) {
  const { user, can } = await getAccess();
  if (!can('system.roles.view')) return <AccessDenied permission="system.roles.view" />;
  const db = getScopedDb(user.schoolId, user.id);

  const view = await describeAccess(db, params.id).catch((e) => {
    if (e instanceof ServiceError && e.status === 404) return null;
    throw e;
  });
  if (!view) notFound();

  const [defs, departments, classes, hostels, stores] = await Promise.all([
    db.roleDefinition.findMany({ select: { key: true, name: true, permissions: { select: { scope: true } } }, orderBy: { name: 'asc' } }),
    db.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.schoolClass.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.facHostel.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.facStore.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const roleChoices: RoleChoice[] = defs.map((d) => ({ key: d.key, name: d.name, pins: PINS.filter((p) => d.permissions.some((g) => g.scope === p)) }));

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title={view.user.fullName}
        description={`${view.user.email}${view.user.active ? '' : ' · deactivated'}`}
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'Roles & Permissions', href: '/system/roles?tab=users' }, { label: view.user.fullName }]}
      />
      <UserAccessClient
        view={view}
        roleChoices={roleChoices}
        places={{ DEPARTMENT: departments, CLASS: classes, HOSTEL: hostels, STORE: stores }}
        permissionChoices={Object.entries(PERMISSIONS).map(([value, label]) => ({ value, label: `${label} (${value})` }))}
        isSelf={view.user.id === user.id}
      />
    </div>
  );
}

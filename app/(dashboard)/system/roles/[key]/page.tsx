import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAccess, guards } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { permissionCatalogue } from '@/lib/access/catalogue';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { CopyRoleButton } from '@/components/system/CopyRoleButton';
import { RoleEditorClient } from '@/components/system/RoleEditorClient';

export const metadata = { title: 'Role · Pfuma' };

const SCOPE_LABEL: Record<string, string> = { SCHOOL: 'Whole school', DEPARTMENT: 'Department', CLASS: 'Class', HOSTEL: 'Hostel', STORE: 'Store' };

export default async function RolePage({ params }: { params: { key: string } }) {
  const { user, can } = await getAccess();
  if (!can('system.roles.view')) return <AccessDenied permission="system.roles.view" />;
  const db = getScopedDb(user.schoolId, user.id);

  const role = await db.roleDefinition.findFirst({
    where: { key: params.key },
    select: {
      name: true, description: true, key: true, isSystem: true,
      permissions: { select: { permissionKey: true, scope: true } },
      users: { where: { user: { active: true, isSupport: false } }, select: { scopeType: true, user: { select: { id: true, fullName: true, email: true } } } },
    },
  });
  if (!role) notFound();

  const grants = Object.fromEntries(role.permissions.map((p) => [p.permissionKey, p.scope as string]));
  // Copying a protected role (Owner, Head, Bursar, Administrator) is the Owner's, so the button is not shown to anyone else.
  const mayCopy = can('system.users.edit') && ((user.roles ?? []).includes('OWNER') || !(guards.PROTECTED_ROLES as readonly string[]).includes(role.key));

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title={role.name}
        description={role.description}
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'Roles & Permissions', href: '/system/roles' }, { label: role.name }]}
        actions={
          <div className="flex items-center gap-2">
            {!role.isSystem && <Badge variant="gold" label="Custom role" />}
            {mayCopy && <CopyRoleButton fromKey={role.key} fromName={role.name} />}
          </div>
        }
      />
      <RoleEditorClient
        roleKey={role.key}
        name={role.name}
        description={role.description}
        isSystem={role.isSystem}
        grants={grants}
        catalogue={permissionCatalogue()}
        canEdit={can('system.users.edit')}
        canAdd={can('system.roles.edit')}
        holders={role.users.length}
      />

      <section className="rounded-2xl bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">Who holds this role ({role.users.length})</h2>
        {role.users.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nobody holds this role yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {role.users.map((h) => (
              <li key={`${h.user.id}-${h.scopeType}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm">
                <span className="font-medium text-ink">{h.user.fullName}</span>
                <span className="text-muted">{h.user.email} · {SCOPE_LABEL[h.scopeType] ?? 'Whole school'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link href="/system/roles" className="min-h-[44px] self-start py-2 text-sm font-medium text-primary hover:underline">← All roles</Link>
    </div>
  );
}

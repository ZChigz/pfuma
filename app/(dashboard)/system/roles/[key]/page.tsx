import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAccess, PERMISSIONS, WILDCARD } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata = { title: 'Role · Pfuma' };

const PAGES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'settings', label: 'School settings' },
  { key: 'users', label: 'Users' },
  { key: 'roles', label: 'Roles & permissions' },
  { key: 'audit', label: 'Audit log' },
  { key: 'subscription', label: 'Subscription' },
] as const;
const ACTIONS = ['view', 'create', 'edit', 'delete', 'deactivate', 'export'] as const;
const SCOPE_LABEL: Record<string, string> = { SCHOOL: 'Whole school', DEPARTMENT: 'Department', CLASS: 'Class', HOSTEL: 'Hostel' };

export default async function RolePage({ params }: { params: { key: string } }) {
  const { user, can } = await getAccess();
  if (!can('system.roles.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);

  const role = await db.roleDefinition.findFirst({
    where: { key: params.key },
    select: {
      name: true, description: true, key: true,
      permissions: { select: { permissionKey: true } },
      users: { where: { user: { active: true, isSupport: false } }, select: { scopeType: true, user: { select: { id: true, fullName: true, email: true } } } },
    },
  });
  if (!role) notFound();

  const grants = new Set(role.permissions.map((p) => p.permissionKey));
  const all = grants.has(WILDCARD);
  const has = (k: string) => all || grants.has(k);

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title={role.name}
        description={role.description}
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'Roles & Permissions' }, { label: role.name }]}
      />
      <p className="rounded-2xl bg-tint px-4 py-3 text-sm text-ink">Access levels will be configurable soon.{all ? ' This role has full access to everything.' : ''}</p>

      <div className="overflow-x-auto rounded-2xl bg-white" tabIndex={0} role="region" aria-label={`What ${role.name} may do`}>
        <table className="w-full min-w-[560px] text-left text-sm text-ink">
          <thead className="border-b border-line">
            <tr>
              <th scope="col" className="sticky left-0 bg-white px-4 py-3.5 text-xs font-medium text-subtle">Page</th>
              {ACTIONS.map((a) => <th key={a} scope="col" className="px-3 py-3.5 text-center text-xs font-medium capitalize text-subtle">{a}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {PAGES.map((p) => (
              <tr key={p.key}>
                <th scope="row" className="sticky left-0 bg-white px-4 py-2.5 text-left font-normal">{p.label}</th>
                {ACTIONS.map((a) => {
                  const k = `system.${p.key}.${a}`;
                  if (!(k in PERMISSIONS)) return <td key={a} className="px-3 py-2.5" />;
                  return (
                    <td key={a} className="px-3 py-2.5 text-center">
                      {has(k) ? <span className="font-semibold text-success" aria-label={`${PERMISSIONS[k as keyof typeof PERMISSIONS]}: allowed`}>✓</span> : <span className="text-subtle" aria-label="Not allowed">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="rounded-2xl bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">Who holds this role ({role.users.length})</h2>
        {role.users.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nobody holds this role yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {role.users.map((h) => (
              <li key={h.user.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm">
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

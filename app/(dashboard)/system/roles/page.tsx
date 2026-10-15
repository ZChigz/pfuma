import { can as canUser, getAccess, MODULES, PERMISSIONS, moduleOf, type PermissionKey } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getModuleStates } from '@/lib/system/modules';
import { ROLES } from '@/lib/validations/system';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { ROLE_LABELS } from '@/lib/role-labels';

export const metadata = { title: 'Roles & Permissions · Pfuma' };

export default async function RolesPage() {
  const { user, can } = await getAccess();
  if (!can('system.roles.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);

  const [grantRows, modules, counts] = await Promise.all([
    db.rolePermission.findMany({ select: { role: true, permission: true } }),
    getModuleStates(db),
    db.user.groupBy({ by: ['role'], where: { active: true }, _count: { _all: true } }),
  ]);
  const disabledModules = Object.entries(modules).filter(([, on]) => !on).map(([k]) => k);
  const people = new Map(counts.map((c) => [c.role, c._count._all]));

  // What each role can really do: the same can() the pages use.
  const holds = (role: (typeof ROLES)[number], permission: PermissionKey) =>
    canUser({ id: 'preview', schoolId: user.schoolId, role, disabledModules, grants: grantRows.filter((g) => g.role === role).map((g) => g.permission) }, permission);

  const keys = Object.keys(PERMISSIONS) as PermissionKey[];

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="Roles & Permissions"
        description="What each role can do. For now only administrators and owners hold the System permissions; other levels are added as data later."
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'Roles & Permissions' }]}
      />

      <div className="overflow-x-auto rounded-2xl bg-white" tabIndex={0} role="region" aria-label="Permissions by role">
        <table className="w-full min-w-[640px] text-left text-sm text-ink">
          <thead className="border-b border-line">
            <tr>
              <th scope="col" className="sticky left-0 bg-white px-4 py-3.5 text-xs font-medium text-subtle">Permission</th>
              {ROLES.map((r) => (
                <th key={r} scope="col" className="px-3 py-3.5 text-center text-xs font-medium text-subtle">
                  {ROLE_LABELS[r]}
                  <span className="block font-normal">{people.get(r) ?? 0} active</span>
                </th>
              ))}
            </tr>
          </thead>
          {MODULES.map((m) => {
            const own = keys.filter((k) => moduleOf(k) === m.key);
            if (own.length === 0) return null;
            return (
              <tbody key={m.key} className="divide-y divide-line">
                <tr className="bg-canvas">
                  <th colSpan={ROLES.length + 1} scope="colgroup" className="px-4 py-2 text-xs font-semibold text-muted">
                    {m.label}{modules[m.key] ? '' : ' · switched off'}
                  </th>
                </tr>
                {own.map((k) => (
                  <tr key={k}>
                    <th scope="row" className="sticky left-0 bg-white px-4 py-2.5 text-left font-normal">
                      {PERMISSIONS[k]}
                      <span className="block font-mono text-[11px] text-subtle">{k}</span>
                    </th>
                    {ROLES.map((r) => (
                      <td key={r} className="px-3 py-2.5 text-center">
                        {holds(r, k) ? <span className="font-semibold text-success" aria-label="Allowed">✓</span> : <span className="text-subtle" aria-label="Not allowed">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            );
          })}
          <tbody className="divide-y divide-line">
            <tr className="bg-canvas">
              <th colSpan={ROLES.length + 1} scope="colgroup" className="px-4 py-2 text-xs font-semibold text-muted">My account</th>
            </tr>
            <tr>
              <td colSpan={ROLES.length + 1} className="px-4 py-2.5 text-sm text-muted">Everyone can see their own profile, change their own password and see their notifications.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

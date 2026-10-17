import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { STAFF_ROLES } from '@/lib/staff-roles';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Roles & Permissions · Pfuma' };

const TABS = [
  { key: 'roles', label: 'Roles' },
  { key: 'users', label: 'By user' },
] as const;

export default async function RolesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { user, can } = await getAccess();
  if (!can('system.roles.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const tab = searchParams.tab === 'users' ? 'users' : 'roles';

  const defs = await db.roleDefinition.findMany({
    select: { key: true, name: true, description: true, isSystem: true, users: { where: { user: { active: true, isSupport: false } }, select: { userId: true } } },
  });
  const order = (k: string) => STAFF_ROLES.findIndex((r) => r.key === k);
  const roles = defs.map((d) => ({ ...d, people: new Set(d.users.map((u) => u.userId)).size })).sort((a, b) => order(a.key) - order(b.key));

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="Roles & Permissions"
        description="The roles in your school and what each one may open. A person can hold several roles."
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'Roles & Permissions' }]}
      />

      <nav className="flex gap-1 overflow-x-auto rounded-2xl bg-white p-1" aria-label="Roles views">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === 'roles' ? '/system/roles' : '/system/roles?tab=users'}
            aria-current={tab === t.key ? 'page' : undefined}
            className={cn('flex min-h-[44px] items-center whitespace-nowrap rounded-xl px-4 text-sm font-medium', tab === t.key ? 'bg-primary text-white' : 'text-muted hover:text-ink')}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'roles' ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {roles.map((r) => (
            <li key={r.key}>
              <Link href={`/system/roles/${r.key}`} className="flex h-full flex-col gap-1 rounded-2xl bg-white p-4 hover:bg-rowhover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{r.name}</span>
                  <span className="whitespace-nowrap text-xs text-muted">{r.people} {r.people === 1 ? 'user' : 'users'}</span>
                </span>
                <span className="text-sm text-muted">{r.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl bg-white p-6 text-sm text-muted">
          <p className="font-medium text-ink">Roles by user is coming soon.</p>
          <p className="mt-1">Here you will give a person a role for the whole school, or only for a department, a class or a hostel. For now, roles are set on the Users page.</p>
        </div>
      )}
    </div>
  );
}

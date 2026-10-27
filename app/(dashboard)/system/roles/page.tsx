import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { STAFF_ROLES } from '@/lib/staff-roles';
import { listExceptions, listRequests } from '@/lib/system/access-admin';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { AccessRequestsClient } from '@/components/system/AccessRequestsClient';
import { ExceptionsClient } from '@/components/system/ExceptionsClient';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Roles & Permissions · Pfuma' };

type TabKey = 'roles' | 'users' | 'requests' | 'exceptions';

export default async function RolesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { user, can } = await getAccess();
  if (!can('system.roles.view')) return <AccessDenied permission="system.roles.view" />;
  const db = getScopedDb(user.schoolId, user.id);

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'roles', label: 'Roles' },
    { key: 'users', label: 'By user' },
    ...(can('system.users.edit') ? [{ key: 'requests' as const, label: 'Access requests' }] : []),
    { key: 'exceptions', label: 'Exceptions' },
  ];
  const asked = typeof searchParams.tab === 'string' ? searchParams.tab : 'roles';
  const tab = (tabs.find((t) => t.key === asked)?.key ?? 'roles') as TabKey;
  const history = searchParams.history === '1';
  const href = (k: TabKey) => (k === 'roles' ? '/system/roles' : `/system/roles?tab=${k}`);

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="Roles & Permissions"
        description="The roles in your school and what each one may open. A person can hold several roles."
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'Roles & Permissions' }]}
      />

      <nav className="flex gap-1 overflow-x-auto rounded-2xl bg-white p-1" aria-label="Roles views">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={href(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={cn('flex min-h-[44px] items-center whitespace-nowrap rounded-xl px-4 text-sm font-medium', tab === t.key ? 'bg-primary text-white' : 'text-muted hover:text-ink')}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'roles' && <RolesTab roles={await loadRoles(db)} />}
      {tab === 'users' && <PeopleTab people={await loadPeople(db)} />}
      {tab === 'requests' && <AccessRequestsClient rows={await listRequests(db)} isOwner={(user.roles ?? []).includes('OWNER')} />}
      {tab === 'exceptions' && <ExceptionsClient rows={await listExceptions(db, { history })} history={history} canExport={can('system.users.export')} />}
    </div>
  );
}

type Db = ReturnType<typeof getScopedDb>;

async function loadRoles(db: Db) {
  const defs = await db.roleDefinition.findMany({
    select: { key: true, name: true, description: true, isSystem: true, users: { where: { user: { active: true, isSupport: false } }, select: { userId: true } } },
  });
  const order = (k: string) => { const i = STAFF_ROLES.findIndex((r) => r.key === k); return i < 0 ? 999 : i; };
  return defs.map((d) => ({ ...d, people: new Set(d.users.map((u) => u.userId)).size })).sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || order(a.key) - order(b.key) || a.name.localeCompare(b.name));
}

function RolesTab({ roles }: { roles: Awaited<ReturnType<typeof loadRoles>> }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {roles.map((r) => (
        <li key={r.key}>
          <Link href={`/system/roles/${r.key}`} className="flex h-full flex-col gap-1 rounded-2xl bg-white p-4 hover:bg-rowhover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-ink">{r.name}{!r.isSystem && <> <Badge variant="gold" label="Custom" /></>}</span>
              <span className="whitespace-nowrap text-xs text-muted">{r.people} {r.people === 1 ? 'user' : 'users'}</span>
            </span>
            <span className="text-sm text-muted">{r.description}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function loadPeople(db: Db) {
  return db.user.findMany({
    where: { isSupport: false },
    orderBy: { fullName: 'asc' },
    select: { id: true, fullName: true, email: true, active: true, userRoles: { select: { scopeType: true, role: { select: { name: true } } } } },
  });
}

function PeopleTab({ people }: { people: Awaited<ReturnType<typeof loadPeople>> }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-white" tabIndex={0} role="region" aria-label="People and their roles">
      <table className="w-full min-w-[560px] text-left text-sm text-ink">
        <thead className="border-b border-line">
          <tr>{['Person', 'Roles', ''].map((h) => <th key={h} scope="col" className="px-4 py-3 text-xs font-medium text-subtle">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {people.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-3"><span className="font-medium">{p.fullName}</span>{!p.active && <span className="ml-2 text-xs text-muted">deactivated</span>}<span className="block text-xs text-muted">{p.email}</span></td>
              <td className="px-4 py-3 text-muted">{p.userRoles.map((r) => (r.scopeType === 'SCHOOL' ? r.role.name : `${r.role.name} (one ${r.scopeType.toLowerCase()})`)).join(', ') || 'None'}</td>
              <td className="px-4 py-3 text-right"><Link href={`/system/users/${p.id}/access`} className="inline-flex min-h-[44px] items-center text-sm font-medium text-primary hover:underline">Manage access</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

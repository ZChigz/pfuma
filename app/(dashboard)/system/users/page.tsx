import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { parseTableQuery } from '@/lib/table-query';
import { listUsers, USER_FILTERS, USER_SORTABLE } from '@/lib/system/users';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { UsersClient } from '@/components/system/UsersClient';

export const metadata = { title: 'Users · Pfuma' };

export default async function UsersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { user, can } = await getAccess();
  if (!can('system.users.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);

  const q = parseTableQuery(searchParams, { sortable: USER_SORTABLE, filterKeys: USER_FILTERS, defaultSort: 'fullName' });
  const { total, rows } = await listUsers(db, q);

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="Users"
        description="Staff accounts and what each person's role is"
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'Users' }]}
      />
      <UsersClient
        rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
        total={total}
        page={q.page}
        pageSize={q.pageSize}
        currentUserId={user.id}
        canCreate={can('system.users.create')}
        canUpdate={can('system.users.update')}
        canDeactivate={can('system.users.deactivate')}
        canResetPassword={can('system.users.reset_password')}
        canExport={can('system.users.export')}
      />
    </div>
  );
}

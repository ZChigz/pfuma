import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { parseTableQuery } from '@/lib/table-query';
import { listUsers, statusOf, userCounts, USER_FILTERS, USER_SORTABLE } from '@/lib/system/users';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { UsersClient } from '@/components/system/UsersClient';
import { LogoutAllButton } from '@/components/admin/LogoutAllButton';

export const metadata = { title: 'Users · Pfuma' };

// The one Users page (the old /system/users redirects here). Every action is shown only when can() allows it.
export default async function UsersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { user, can } = await getAccess();
  if (!can('system.users.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);

  const q = parseTableQuery(searchParams, { sortable: USER_SORTABLE, filterKeys: USER_FILTERS, defaultSort: 'fullName' });
  const [{ total, rows }, counts, school] = await Promise.all([
    listUsers(db, q),
    userCounts(db),
    db.school.findUnique({ where: { id: user.schoolId }, select: { name: true } }),
  ]);
  const canEdit = can('system.users.edit');

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="Users"
        description="Staff accounts. New people choose their own password from an invite."
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'Users' }]}
        actions={canEdit ? <LogoutAllButton /> : undefined}
      />
      <UsersClient
        rows={rows.map((r) => ({
          id: r.id, fullName: r.fullName, email: r.email, phone: r.phone, title: r.title, roles: r.roles, status: statusOf(r),
          lastLoginAt: r.lastLoginAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
        }))}
        total={total}
        page={q.page}
        pageSize={q.pageSize}
        counts={counts}
        currentUserId={user.id}
        schoolName={school?.name ?? 'your school'}
        canCreate={can('system.users.create')}
        canUpdate={canEdit}
        canDeactivate={can('system.users.deactivate')}
        canResetPassword={canEdit}
        canTempPassword={canEdit}
        canSignOut={canEdit}
        canExport={can('system.users.export')}
        canInvite={can('system.users.create')}
        canImport={can('system.users.create')}
        canViewActivity={can('system.audit.view')}
      />
    </div>
  );
}

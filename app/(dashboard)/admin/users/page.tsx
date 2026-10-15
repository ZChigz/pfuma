import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { AddUserModal } from '@/components/admin/AddUserModal';
import { UserRowActions } from '@/components/admin/UserRowActions';
import { LogoutAllButton } from '@/components/admin/LogoutAllButton';
import { canManageUsers } from '@/lib/permissions';
import type { SessionUser } from '@/types';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  DIRECTOR: 'Director',
  HEAD: 'Head Teacher',
  BURSAR: 'Bursar',
  TEACHER: 'Teacher',
  LIBRARIAN: 'Librarian',
};

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canManageUsers(user.role); } catch { redirect('/accounting'); }

  const users = await db.user.findMany({
    where: { schoolId: user.schoolId },
    select: { id: true, fullName: true, email: true, role: true, active: true },
    orderBy: { fullName: 'asc' },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Users</h1>
          <p className="mt-1 text-sm text-muted">Manage staff accounts and access</p>
        </div>
        <div className="flex items-center gap-2">
          <LogoutAllButton />
          <AddUserModal />
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white">
        <table className="w-full text-left text-sm text-ink">
          <thead className="border-b border-line bg-white">
            <tr>
              {['Name', 'Email', 'Role', 'Active', 'Actions'].map((h, i) => (
                <th key={i} className="px-4 py-3.5 text-xs font-medium text-subtle">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium">{u.fullName}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{u.email}</td>
                <td className="px-4 py-3">
                  <Badge label={ROLE_LABELS[u.role] ?? u.role} variant="neutral" />
                </td>
                <td className="px-4 py-3">
                  <Badge
                    label={u.active ? 'Active' : 'Inactive'}
                    variant={u.active ? 'success' : 'danger'}
                  />
                </td>
                <td className="px-4 py-3">
                  <UserRowActions userId={u.id} active={u.active} />
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

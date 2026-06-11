import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { AddUserModal } from '@/components/admin/AddUserModal';
import { UserRowActions } from '@/components/admin/UserRowActions';
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

  try { await canManageUsers(user.role); } catch { redirect('/accounting'); }

  const users = await prisma.user.findMany({
    where: { schoolId: user.schoolId },
    select: { id: true, fullName: true, email: true, role: true, active: true },
    orderBy: { fullName: 'asc' },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#292524]">Users</h1>
          <p className="mt-0.5 text-sm text-[#78716c]">Manage staff accounts and access</p>
        </div>
        <AddUserModal />
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
        <table className="w-full text-left text-sm text-[#292524]">
          <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
            <tr>
              {['Name', 'Email', 'Role', 'Active', 'Actions'].map((h, i) => (
                <th key={i} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e7e5e4] bg-white">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium">{u.fullName}</td>
                <td className="px-4 py-3 font-mono text-xs text-[#78716c]">{u.email}</td>
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
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-[#78716c]">
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

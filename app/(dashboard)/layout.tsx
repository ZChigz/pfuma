import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { AccessProvider } from '@/components/access/AccessProvider';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { ToastProvider } from '@/components/ui/Toast';
import { getAccess } from '@/lib/access';
import { uiPermissions } from '@/lib/access/ui';
import { STAFF_ROLE_LABEL } from '@/lib/staff-roles';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  // What the person may use, for hiding menu items and buttons in the browser (the server checks again on every action).
  const { user } = await getAccess();

  return (
    <AccessProvider permissions={uiPermissions(user)} roles={(user.roles ?? []).map((k) => STAFF_ROLE_LABEL[k] ?? k.toLowerCase().replace(/_/g, ' '))}>
      <ToastProvider>
        <DashboardShell>{children}</DashboardShell>
      </ToastProvider>
    </AccessProvider>
  );
}

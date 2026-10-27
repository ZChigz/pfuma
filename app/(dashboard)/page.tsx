import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

// Every member of staff holds system.dashboard.view, so the dashboard is home for everyone. What it shows, and what the menu offers
// beyond it, follows the person's permissions (lib/nav.ts), never a role name.
export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  redirect('/system/dashboard');
}

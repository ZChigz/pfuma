import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import type { SessionUser } from '@/types';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;

  switch (user.role) {
    case 'ADMIN':     redirect('/admin');
    case 'DIRECTOR':  redirect('/director');
    case 'HEAD':      redirect('/head');
    case 'BURSAR':    redirect('/bursar/students');
    case 'TEACHER':   redirect('/teacher/marks');
    case 'LIBRARIAN': redirect('/library');
    default:          redirect('/login');
  }
}

import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getScopedDb } from '@/lib/scoped-db';
import { legacyRetired } from '@/lib/finance/legacy-guard';
import type { SessionUser } from '@/types';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;

  switch (user.role) {
    case 'ADMIN':     redirect('/system/dashboard');
    case 'DIRECTOR':  redirect('/director');
    case 'HEAD':      redirect('/head');
    // A school that keeps its money in Finance sends the bursar there.
    case 'BURSAR':    redirect((await legacyRetired(getScopedDb(user.schoolId, user.id), user.schoolId)) ? '/finance' : '/bursar/students');
    case 'TEACHER':   redirect('/teacher/marks');
    case 'LIBRARIAN': redirect('/library');
    default:          redirect('/login');
  }
}

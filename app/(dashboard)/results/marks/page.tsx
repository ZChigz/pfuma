import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { MarkEntryClient } from '@/components/results/MarkEntryClient';
import type { SessionUser } from '@/types';

export default async function MarksPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;

  return <MarkEntryClient role={user.role} userId={user.id} />;
}

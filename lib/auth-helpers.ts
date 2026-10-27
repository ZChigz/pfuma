import { auth } from '@/lib/auth';
import type { SessionUser } from '@/types';

export async function getCurrentUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  return session.user as SessionUser;
}

export async function getSchoolId(): Promise<string> {
  const user = await getCurrentUser();
  return user.schoolId;
}

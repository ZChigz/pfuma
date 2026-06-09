import { auth } from '@/lib/auth';
import type { SessionUser, UserRole } from '@/types';

export async function getCurrentUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  return session.user as SessionUser;
}

export async function requireRole(roles: UserRole[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!roles.includes(user.role)) {
    throw new Error('Forbidden');
  }
  return user;
}

export async function getSchoolId(): Promise<string> {
  const user = await getCurrentUser();
  return user.schoolId;
}

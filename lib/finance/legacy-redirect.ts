// The first accounting pages (/bursar, /head/fees, /teacher/requests ...) send people to the Finance module once their school has moved
// to it, so nobody works on the frozen older tables by mistake.
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { legacyRetired } from '@/lib/finance/legacy-guard';

export async function sendToFinance(to: string): Promise<void> {
  const session = await auth();
  const u = session?.user as { id?: string; schoolId?: string } | undefined;
  if (!u?.id || !u.schoolId) return;
  if (await legacyRetired(getScopedDb(u.schoolId, u.id), u.schoolId)) redirect(to);
}

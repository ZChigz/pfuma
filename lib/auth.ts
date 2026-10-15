import bcrypt from 'bcryptjs';
import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import { authConfig } from '@/lib/auth.config';
import { hashPassword, needsRehash } from '@/lib/password';
import { clearLoginFailures, loginLockedFor, recordLoginFailure } from '@/lib/login-guard';
import { clientIp } from '@/lib/rate-limit';
import { revalidateToken, type SessionToken } from '@/lib/session-check';
import type { UserRole } from '@/types';

export class AccountLockedError extends CredentialsSignin {
  code = 'account_locked';
}

// Compared against when the email is unknown, so a missing account costs the
// same time as a wrong password.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash('not-a-real-password', 12));

/** Checks an email + password. Returns the user for the JWT, null for a wrong login, throws AccountLockedError while locked. */
export async function authorizeCredentials(
  credentials: Partial<Record<'email' | 'password', unknown>> | undefined,
  request?: Request,
) {
  if (!credentials?.email || !credentials?.password) return null;
  const email = String(credentials.email).trim();
  const password = String(credentials.password);
  const ip = request ? clientIp(request.headers) : '127.0.0.1';

  if ((await loginLockedFor(email, ip)) > 0) throw new AccountLockedError();

  // The same email can exist in more than one school; the password decides which.
  const candidates = await prisma.user.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
  });

  let matched: (typeof candidates)[number] | null = null;
  for (const u of candidates) {
    if (!u.active || !u.passwordHash) continue;
    if (await bcrypt.compare(password, u.passwordHash)) {
      matched = u;
      break;
    }
  }
  if (candidates.length === 0) await bcrypt.compare(password, await getDummyHash());

  if (!matched) {
    const locked = await recordLoginFailure(email, ip, candidates);
    if (locked) throw new AccountLockedError();
    return null;
  }

  await clearLoginFailures(email, ip);

  // Feeds "logged in this week" on the dashboard. A failure here must not block sign-in.
  try {
    await prisma.user.update({ where: { id: matched.id }, data: { lastLoginAt: new Date() } });
  } catch {
    // ignore
  }

  // Bring hashes made with the old, cheaper cost up to the current one.
  if (needsRehash(matched.passwordHash)) {
    try {
      await prisma.user.update({ where: { id: matched.id }, data: { passwordHash: await hashPassword(password) } });
    } catch {
      // The password predates the length rule; it keeps working until changed.
    }
  }

  return {
    id: matched.id,
    email: matched.email,
    schoolId: matched.schoolId,
    role: matched.role as UserRole,
    fullName: matched.fullName,
    tokenVersion: matched.tokenVersion,
    mustChangePassword: matched.mustChangePassword,
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: (credentials, request) => authorizeCredentials(credentials, request),
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt(params) {
      const token = await authConfig.callbacks.jwt(params);
      if (params.user) return token;
      // Re-read active / role / tokenVersion at most every 5 minutes.
      return (await revalidateToken(token as unknown as SessionToken)) as typeof token | null;
    },
  },
});

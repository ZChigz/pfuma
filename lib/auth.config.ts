// Edge-safe part of the Auth.js configuration (no database, no bcrypt). The
// middleware uses this on its own; lib/auth.ts adds the Credentials provider and
// the database re-check for everything running on Node.
import type { NextAuthConfig } from 'next-auth';
import type { UserRole } from '@/types';

/** JWT lifetime: 8 hours. */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      schoolId: string;
      role: UserRole;
      fullName: string;
      mustChangePassword: boolean;
      /** Keys of the roles held, as of the last check (at most a minute old). The server reads the grants themselves. */
      roles: string[];
      /** Moves whenever the person's access changes; a stale token is rebuilt within a minute. */
      permVersion: number;
      /** A Pfuma support person looking in read-only (set by the platform console, never by sign-in). */
      support?: boolean;
      supportAdminId?: string;
    };
  }

  interface User {
    id: string;
    schoolId: string;
    role: UserRole;
    fullName: string;
    tokenVersion: number;
    mustChangePassword: boolean;
    roles: string[];
    permVersion: number;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id: string;
    schoolId: string;
    role: UserRole;
    fullName: string;
    tokenVersion: number;
    mustChangePassword: boolean;
    roles?: string[];
    permVersion?: number;
    checkedAt: number;
    support?: boolean;
    supportAdminId?: string;
  }
}

export const authConfig = {
  pages: { signIn: '/login' },
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.schoolId = user.schoolId;
        token.role = user.role;
        token.fullName = user.fullName;
        token.tokenVersion = user.tokenVersion;
        token.mustChangePassword = user.mustChangePassword;
        token.roles = user.roles;
        token.permVersion = user.permVersion;
        token.checkedAt = Date.now();
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.schoolId = token.schoolId;
      session.user.role = token.role;
      session.user.fullName = token.fullName;
      session.user.mustChangePassword = token.mustChangePassword === true;
      session.user.roles = Array.isArray(token.roles) ? token.roles : [];
      session.user.permVersion = typeof token.permVersion === 'number' ? token.permVersion : 0;
      session.user.support = token.support === true;
      session.user.supportAdminId = typeof token.supportAdminId === 'string' ? token.supportAdminId : undefined;
      return session;
    },
  },
} satisfies NextAuthConfig;

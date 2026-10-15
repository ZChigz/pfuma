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
    };
  }

  interface User {
    id: string;
    schoolId: string;
    role: UserRole;
    fullName: string;
    tokenVersion: number;
    mustChangePassword: boolean;
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
    checkedAt: number;
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
      return session;
    },
  },
} satisfies NextAuthConfig;

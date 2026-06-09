import bcrypt from 'bcryptjs';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import type { UserRole } from '@/types';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      schoolId: string;
      role: UserRole;
      fullName: string;
    };
  }

  interface User {
    id: string;
    schoolId: string;
    role: UserRole;
    fullName: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    schoolId: string;
    role: UserRole;
    fullName: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  pages: {
    signIn: '/login',
  },
  session: { strategy: 'jwt' },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findFirst({
          where: { email: credentials.email as string },
        });

        if (!user || !user.active || !user.passwordHash) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash,
        );
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          schoolId: user.schoolId,
          role: user.role as UserRole,
          fullName: user.fullName,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.schoolId = user.schoolId;
        token.role = user.role;
        token.fullName = user.fullName;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.schoolId = token.schoolId;
      session.user.role = token.role;
      session.user.fullName = token.fullName;
      return session;
    },
  },
});

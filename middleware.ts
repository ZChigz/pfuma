import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/lib/auth.config';
import { clientIp, getLimiters } from '@/lib/rate-limit';
import type { NextRequest } from 'next/server';
import type { UserRole } from '@/types';

// The middleware runs on the edge, so it verifies the JWT signature only. The
// "is this user still active / same role" check happens in lib/auth.ts, which
// every API route and page reaches through auth().
const { auth } = NextAuth(authConfig);

// ─── Role-based route protection ──────────────────────────────────────────────

const ROLE_HOME: Record<UserRole, string> = {
  ADMIN:     '/admin',
  DIRECTOR:  '/director',
  HEAD:      '/head',
  BURSAR:    '/bursar/students',
  TEACHER:   '/teacher/marks',
  LIBRARIAN: '/library',
};

function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Director may void verified payments/expenses via the accounting API.
const VOID_API_PATTERN = /^\/api\/accounting\/(payments|expenses)\/[^/]+\/void$/;

// Directors also open a payment's proof of payment before verifying or voiding it.
const PROOF_API_PATTERN = /^\/api\/accounting\/payments\/[^/]+\/proof$/;

// Portal link / PIN management: ADMIN, HEAD and BURSAR only.
const PORTAL_ADMIN_API = ['/api/portal-links'];

const ROLE_ALLOWED: Record<UserRole, (pathname: string) => boolean> = {
  // Admin subjects page manages grade boundaries via the results API.
  ADMIN: (p) => startsWithAny(p, ['/admin', '/api/admin', '/api/results/grade-boundaries', '/api/results/settings', ...PORTAL_ADMIN_API]),

  DIRECTOR: (p) =>
    startsWithAny(p, ['/director', '/api/director', '/accounting/dashboard', '/api/accounting/dashboard', '/api/accounting/requests']) ||
    VOID_API_PATTERN.test(p) ||
    PROOF_API_PATTERN.test(p),

  HEAD: (p) =>
    startsWithAny(p, [
      '/head',
      '/accounting/students',
      '/accounting/payments',
      '/accounting/expenses',
      '/accounting/settings',
      '/results',
      '/assets',
      '/api/accounting',
      '/api/results',
      '/api/assets',
      ...PORTAL_ADMIN_API,
    ]) ||
    // Bulk fee modal previews the student list from the admin students API.
    p === '/api/admin/students',

  BURSAR: (p) =>
    startsWithAny(p, [
      '/bursar',
      '/api/accounting/students',
      '/api/accounting/payments',
      '/api/accounting/expenses',
      '/api/accounting/exchange-rate',
      '/api/accounting/requests',
      ...PORTAL_ADMIN_API,
    ]),

  TEACHER: (p) =>
    startsWithAny(p, ['/teacher', '/api/results/marks', '/api/results/remarks', '/api/accounting/requests']),

  LIBRARIAN: (p) => startsWithAny(p, ['/library', '/api/library']),
};

// Reachable by any signed-in user, whatever their role.
const ANY_ROLE = ['/change-password', '/api/account'];

// ─── Rate limiting ────────────────────────────────────────────────────────────

function tooManyRequests(retryAfter: number): Response {
  return new Response(JSON.stringify({ success: false, message: 'Too many requests' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
  });
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export default auth(async (req: NextRequest & { auth: { user?: { id?: string; role: UserRole; mustChangePassword?: boolean } } | null }) => {
  const { nextUrl } = req;
  const { pathname } = nextUrl;
  const ip = clientIp(req.headers);
  const limiters = getLimiters();

  // Parent portal: 30 requests a minute per IP.
  if (pathname.startsWith('/portal') || pathname.startsWith('/api/portal/') || pathname.startsWith('/reset-password') || pathname.startsWith('/api/password-reset')) {
    const r = await limiters.portal.check(ip);
    if (!r.allowed) return tooManyRequests(r.retryAfter);
  }

  // Everything else under /api: 100 a minute per signed-in user, or per IP when
  // not signed in. Signed-in requests also count against a looser per-IP ceiling,
  // because a whole school's staff may share one address.
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/portal/') && !pathname.startsWith('/api/password-reset')) {
    const userId = req.auth?.user?.id;
    const checks = userId
      ? [limiters.api.check(`user:${userId}`), limiters.apiPerIp.check(ip)]
      : [limiters.api.check(`ip:${ip}`)];
    for (const r of await Promise.all(checks)) {
      if (!r.allowed) return tooManyRequests(r.retryAfter);
    }
  }

  const role = req.auth?.user?.role;
  const isLoggedIn = !!role;

  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/portal') ||
    pathname.startsWith('/api/portal/') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/api/password-reset') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/upload') ||
    pathname.startsWith('/api/health');

  if (!isLoggedIn && !isPublic) {
    // API callers get a status code, not an HTML redirect.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    return Response.redirect(new URL('/login', nextUrl));
  }

  // Accounts created or reset by an admin must pick their own password first.
  if (isLoggedIn && req.auth?.user?.mustChangePassword && !startsWithAny(pathname, [...ANY_ROLE, '/api/auth'])) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ success: false, message: 'Change your password to continue' }, { status: 403 });
    }
    return Response.redirect(new URL('/change-password', nextUrl));
  }

  if (isLoggedIn && pathname.startsWith('/login')) {
    return Response.redirect(new URL(ROLE_HOME[role], nextUrl));
  }

  // Each role only sees their own routes — anything else bounces home.
  if (isLoggedIn && !isPublic && pathname !== '/' && !startsWithAny(pathname, ANY_ROLE)) {
    if (!ROLE_ALLOWED[role](pathname)) {
      return Response.redirect(new URL(ROLE_HOME[role], nextUrl));
    }
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

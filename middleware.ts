import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/lib/auth.config';
import { clientIp, getLimiters } from '@/lib/rate-limit';
import { supportBlocked } from '@/lib/support-guard';
import type { NextRequest } from 'next/server';

// The middleware runs on the edge, so it verifies the JWT signature only. The
// "is this user still active / still holds these roles" check happens in lib/auth.ts, which
// every API route and page reaches through auth().
const { auth } = NextAuth(authConfig);

// ─── Where a signed-in person lands ──────────────────────────────────────────
// "/" works out each person's home from their permissions (lib/home.ts): the edge cannot, as it only sees the JWT. Every page and
// every API route asks can() / requirePermission() itself (lib/access.ts), and the menu shows only what they may use.
const HOME = '/';

function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Reachable by a user who still has to change their password: the change-password page and the areas whose pages and routes check
// permissions themselves.
// /system and /api/system: every signed-in user reaches them, and can() (lib/access.ts) decides what they may do.
// /students and /api/students (Student Information), /academics and /api/academics, /exams and /api/exams (Examinations) /finance and /api/finance (Finance), and /hr and /api/hr (HR & Staff) work the same way: every route and page asks can().
const OPEN_AREAS = ['/change-password', '/api/account', '/system', '/api/system', '/students', '/api/students', '/academics', '/api/academics', '/exams', '/api/exams', '/finance', '/api/finance', '/hr', '/api/hr', '/print'];

// ─── Rate limiting ────────────────────────────────────────────────────────────

function tooManyRequests(retryAfter: number): Response {
  return new Response(JSON.stringify({ success: false, message: 'Too many requests' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
  });
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export default auth(async (req: NextRequest & { auth: { user?: { id?: string; mustChangePassword?: boolean; support?: boolean } } | null }) => {
  const { nextUrl } = req;
  const { pathname } = nextUrl;
  const ip = clientIp(req.headers);
  const limiters = getLimiters();

  // Parent portal: 30 requests a minute per IP.
  if (pathname.startsWith('/portal') || pathname.startsWith('/verify') || pathname.startsWith('/api/portal/') || pathname.startsWith('/reset-password') || pathname.startsWith('/api/password-reset')) {
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

  const isLoggedIn = !!req.auth?.user?.id;

  // A Pfuma support person looks in read-only: no change request gets through.
  if (isLoggedIn && req.auth?.user?.support && supportBlocked(req.method, pathname)) {
    return NextResponse.json({ success: false, message: 'Pfuma support can look but not change anything' }, { status: 403 });
  }

  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/portal') ||
    // Anyone can check a report card's verification code.
    pathname.startsWith('/verify') ||
    pathname.startsWith('/api/portal/') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/api/password-reset') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/upload') ||
    pathname.startsWith('/api/health') ||
    // The register's service worker script (it holds no data; the pages it caches stay behind sign-in).
    pathname === '/sw.js' ||
    // The Pfuma console has its own sign-in (lib/platform/session.ts); it checks the cookie itself.
    pathname === '/platform' ||
    pathname.startsWith('/platform/') ||
    pathname.startsWith('/api/platform/') ||
    pathname.startsWith('/api/cron/');

  if (!isLoggedIn && !isPublic) {
    // API callers get a status code, not an HTML redirect.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    return Response.redirect(new URL('/login', nextUrl));
  }

  // Accounts created or reset by an admin must pick their own password first.
  if (isLoggedIn && req.auth?.user?.mustChangePassword && !startsWithAny(pathname, [...OPEN_AREAS, '/api/auth'])) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ success: false, message: 'Change your password to continue' }, { status: 403 });
    }
    return Response.redirect(new URL('/change-password', nextUrl));
  }

  if (isLoggedIn && pathname.startsWith('/login')) {
    return Response.redirect(new URL(HOME, nextUrl));
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

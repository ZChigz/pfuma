import { auth } from '@/lib/auth';
import type { NextRequest } from 'next/server';
import type { UserRole } from '@/types';

// ─── In-memory rate limiter ───────────────────────────────────────────────────
// TODO: Replace with a Redis-based limiter (e.g. @upstash/ratelimit) before
// deploying to a multi-instance production environment. The in-memory map is
// per-process and does not share state across pods or serverless invocations.

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX       = 100;    // requests per window per IP

interface WindowEntry {
  count:     number;
  windowStart: number;
}

const ipMap = new Map<string, WindowEntry>();

function checkRateLimit(ip: string): boolean {
  const now  = Date.now();
  const entry = ipMap.get(ip);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    ipMap.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) return false;

  entry.count += 1;
  return true;
}

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

const ROLE_ALLOWED: Record<UserRole, (pathname: string) => boolean> = {
  ADMIN: (p) => startsWithAny(p, ['/admin', '/api/admin']),

  DIRECTOR: (p) =>
    startsWithAny(p, ['/director', '/accounting/dashboard', '/api/accounting/dashboard', '/api/accounting/requests']) ||
    VOID_API_PATTERN.test(p),

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
    ]),

  BURSAR: (p) =>
    startsWithAny(p, [
      '/bursar',
      '/api/accounting/students',
      '/api/accounting/payments',
      '/api/accounting/expenses',
      '/api/accounting/exchange-rate',
      '/api/accounting/requests',
    ]),

  TEACHER: (p) =>
    startsWithAny(p, ['/teacher', '/api/results/marks', '/api/accounting/requests']),

  LIBRARIAN: (p) => startsWithAny(p, ['/library', '/api/library']),
};

// ─── Middleware ───────────────────────────────────────────────────────────────

export default auth((req: NextRequest & { auth: { user?: { role: UserRole } } | null }) => {
  const { nextUrl } = req;
  const { pathname } = nextUrl;

  // Rate-limit all /api/ routes
  if (pathname.startsWith('/api/')) {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      req.headers.get('x-real-ip') ??
      '127.0.0.1';

    if (!checkRateLimit(ip)) {
      return new Response(
        JSON.stringify({ success: false, message: 'Too many requests' }),
        {
          status:  429,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  }

  const role = req.auth?.user?.role;
  const isLoggedIn = !!role;

  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/portal') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/upload') ||
    pathname.startsWith('/api/health');

  if (!isLoggedIn && !isPublic) {
    return Response.redirect(new URL('/login', nextUrl));
  }

  if (isLoggedIn && pathname.startsWith('/login')) {
    return Response.redirect(new URL(ROLE_HOME[role], nextUrl));
  }

  // Each role only sees their own routes — anything else bounces home.
  if (isLoggedIn && !isPublic && pathname !== '/') {
    if (!ROLE_ALLOWED[role](pathname)) {
      return Response.redirect(new URL(ROLE_HOME[role], nextUrl));
    }
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

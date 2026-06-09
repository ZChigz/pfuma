import { auth } from '@/lib/auth';
import type { NextRequest } from 'next/server';

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

// ─── Middleware ───────────────────────────────────────────────────────────────

export default auth((req: NextRequest & { auth: unknown }) => {
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

  // Auth gate — allow public paths through
  const isLoggedIn = !!(req as { auth: unknown }).auth;

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
    return Response.redirect(new URL('/accounting', nextUrl));
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

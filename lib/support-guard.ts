// Edge-safe rule for Pfuma support sessions: they look, they never change. Every API call that is not a
// read is refused, except leaving the session and Auth.js's own sign-out.
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALLOWED_CHANGES = ['/api/system/support/end', '/api/auth/'];

export function supportBlocked(method: string, pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return false;
  if (READS.has(method.toUpperCase())) return false;
  return !ALLOWED_CHANGES.some((p) => pathname === p || pathname.startsWith(p));
}

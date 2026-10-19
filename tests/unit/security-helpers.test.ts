// @vitest-environment node
import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BCRYPT_COST, PASSWORD_MIN_LENGTH, generateTempPassword, hashPassword, needsRehash, passwordProblem,
} from '@/lib/password';
import { LIMITS, _resetRateLimitForTests, clientIp, createLimiter, getCounterStore } from '@/lib/rate-limit';
import { POP_ALLOWED_TYPES, POP_MAX_BYTES, newProofKey, proofKeyBelongsTo } from '@/lib/proof-of-payment';
import { generatePortalPin, generatePortalToken, hashPortalToken, isValidPin, PORTAL_TOKEN_BYTES } from '@/lib/portal';

describe('password rules', () => {
  it('requires at least 10 characters', () => {
    expect(passwordProblem('123456789')).toMatch(/at least 10/);
    expect(passwordProblem('1234567890')).toBeNull();
    expect(PASSWORD_MIN_LENGTH).toBe(10);
  });

  it('refuses passwords bcrypt would silently truncate', () => {
    expect(passwordProblem('a'.repeat(73))).toMatch(/at most 72/);
    expect(passwordProblem('a'.repeat(72))).toBeNull();
  });

  it('hashes with bcrypt cost 12 and refuses a weak password', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(bcrypt.getRounds(hash)).toBe(12);
    expect(BCRYPT_COST).toBe(12);
    expect(await bcrypt.compare('correct horse battery', hash)).toBe(true);
    expect(() => hashPassword('short')).toThrow(/at least 10/);
  });

  it('flags old cheaper hashes for rehashing', () => {
    expect(needsRehash(bcrypt.hashSync('whatever-123', 10))).toBe(true);
    expect(needsRehash(bcrypt.hashSync('whatever-123', 12))).toBe(false);
    expect(needsRehash('not a hash')).toBe(false);
  });

  it('generates temporary passwords that satisfy the rules and do not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generateTempPassword();
      expect(p.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
      expect(passwordProblem(p)).toBeNull();
      expect(p).toMatch(/^[A-Za-z0-9]+$/);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});

describe('rate limits (in-process fallback)', () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    _resetRateLimitForTests();
  });

  it('uses the limits from the spec', () => {
    expect(LIMITS.portal).toEqual({ max: 30, windowSeconds: 60 });
    expect(LIMITS.api).toEqual({ max: 100, windowSeconds: 60 });
    expect(LIMITS.loginMax).toBe(5);
    expect(LIMITS.loginWindow).toBe(15 * 60);
    expect(LIMITS.loginLock).toBe(15 * 60);
  });

  it('allows the limit and refuses the next request, per key', async () => {
    const limiter = createLimiter('t1', 3, 60);
    for (let i = 0; i < 3; i++) expect((await limiter.check('ip-1')).allowed).toBe(true);
    const blocked = await limiter.check('ip-1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect((await limiter.check('ip-2')).allowed).toBe(true);
  });

  it('starts a fresh window after it expires', async () => {
    vi.useFakeTimers();
    try {
      const limiter = createLimiter('t2', 1, 60);
      expect((await limiter.check('k')).allowed).toBe(true);
      expect((await limiter.check('k')).allowed).toBe(false);
      vi.advanceTimersByTime(61_000);
      expect((await limiter.check('k')).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counter store counts, reports time left and can lock and clear', async () => {
    const store = getCounterStore();
    expect(await store.incr('c', 900)).toBe(1);
    expect(await store.incr('c', 900)).toBe(2);
    expect(await store.ttl('c')).toBeGreaterThan(890);
    await store.set('lock', 900);
    expect(await store.ttl('lock')).toBeGreaterThan(890);
    await store.del('c');
    expect(await store.ttl('c')).toBe(0);
  });

  it('reads the client IP from proxy headers', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '41.1.2.3, 10.0.0.1' }))).toBe('41.1.2.3');
    expect(clientIp(new Headers({ 'x-real-ip': '41.9.9.9' }))).toBe('41.9.9.9');
    expect(clientIp(new Headers())).toBe('127.0.0.1');
  });
});

describe('proof-of-payment keys and limits', () => {
  it('allows only images and PDF, max 5 MB', () => {
    expect([...POP_ALLOWED_TYPES].sort()).toEqual(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
    expect(POP_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it('keys carry the school id and cannot be used by another school', () => {
    const key = newProofKey('schoolA');
    expect(key.startsWith('pop:schoolA:')).toBe(true);
    expect(proofKeyBelongsTo(key, 'schoolA')).toBe(true);
    expect(proofKeyBelongsTo(key, 'schoolB')).toBe(false);
    expect(proofKeyBelongsTo('pop:schoolA:', 'schoolA')).toBe(false);
    expect(proofKeyBelongsTo('something-else', 'schoolA')).toBe(false);
    expect(newProofKey('schoolA')).not.toBe(key);
  });
});

describe('portal tokens and PINs', () => {
  it('tokens are 32 random bytes and unique', () => {
    expect(PORTAL_TOKEN_BYTES).toBe(32);
    const a = generatePortalToken();
    const b = generatePortalToken();
    expect(Buffer.from(a, 'base64url').length).toBe(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('only a SHA-256 hash is derived from the token', () => {
    const hash = hashPortalToken('abc');
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hash).not.toContain('abc');
  });

  it('PINs are four digits, including leading zeros', () => {
    for (let i = 0; i < 500; i++) expect(isValidPin(generatePortalPin())).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12345')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin('0042')).toBe(true);
  });
});

// Rate limiting that works on Vercel: state lives in Upstash Redis, so every
// serverless instance and the edge middleware share the same counters.
//
// Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN. Without them
// (local development, tests) an in-process fallback is used, which is only
// correct for a single instance. If Redis is configured but unreachable the
// limiters fail open and the failure is logged — the site must not go down
// because the limiter did.
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the caller may try again (0 when allowed). */
  retryAfter: number;
}

export interface Limiter {
  check(key: string): Promise<LimitResult>;
}

export interface CounterStore {
  /** Adds one to the counter, starting a ttl-second window on the first hit. Returns the new count. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** Seconds left on the key's window, 0 when it does not exist. */
  ttl(key: string): Promise<number>;
  set(key: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

function warn(message: string, err?: unknown) {
  // console, not lib/logger: this file also runs in the edge middleware.
  console.warn(JSON.stringify({ level: 'warn', message, error: err instanceof Error ? err.message : undefined }));
}

let redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    redis = new Redis({ url, token });
  } else {
    redis = null;
    if (process.env.NODE_ENV === 'production') {
      warn('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set: rate limits are per-instance only');
    }
  }
  return redis;
}

// ─── In-process fallback ─────────────────────────────────────────────────────

interface Bucket { count: number; resetAt: number }
const memory = new Map<string, Bucket>();

function sweep(now: number) {
  if (memory.size < 5000) return;
  memory.forEach((b, k) => {
    if (b.resetAt <= now) memory.delete(k);
  });
}

const memoryStore: CounterStore = {
  async incr(key, ttl) {
    const now = Date.now();
    sweep(now);
    const b = memory.get(key);
    if (!b || b.resetAt <= now) {
      memory.set(key, { count: 1, resetAt: now + ttl * 1000 });
      return 1;
    }
    b.count += 1;
    return b.count;
  },
  async ttl(key) {
    const b = memory.get(key);
    if (!b || b.resetAt <= Date.now()) return 0;
    return Math.ceil((b.resetAt - Date.now()) / 1000);
  },
  async set(key, ttl) {
    memory.set(key, { count: 1, resetAt: Date.now() + ttl * 1000 });
  },
  async del(key) {
    memory.delete(key);
  },
};

const redisStore = (r: Redis): CounterStore => ({
  async incr(key, ttl) {
    const n = await r.incr(key);
    if (n === 1) await r.expire(key, ttl);
    return n;
  },
  async ttl(key) {
    const t = await r.ttl(key);
    return t > 0 ? t : 0;
  },
  async set(key, ttl) {
    await r.set(key, 1, { ex: ttl });
  },
  async del(key) {
    await r.del(key);
  },
});

/** Counters and locks (login lockout, PIN attempts). Shared across instances when Redis is configured. */
export function getCounterStore(): CounterStore {
  const r = getRedis();
  if (!r) return memoryStore;
  const store = redisStore(r);
  // Fail open if Redis errors.
  return {
    incr: (k, t) => store.incr(k, t).catch((e) => (warn('rate-limit store error', e), 0)),
    ttl: (k) => store.ttl(k).catch((e) => (warn('rate-limit store error', e), 0)),
    set: (k, t) => store.set(k, t).catch((e) => warn('rate-limit store error', e)),
    del: (k) => store.del(k).catch((e) => warn('rate-limit store error', e)),
  };
}

// ─── Sliding-window limiters ─────────────────────────────────────────────────

export function createLimiter(name: string, max: number, windowSeconds: number): Limiter {
  const r = getRedis();
  if (r) {
    const rl = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(max, `${windowSeconds} s`),
      prefix: `pfuma:rl:${name}`,
      analytics: false,
    });
    return {
      async check(key) {
        try {
          const res = await rl.limit(key);
          return {
            allowed: res.success,
            remaining: res.remaining,
            retryAfter: res.success ? 0 : Math.max(1, Math.ceil((res.reset - Date.now()) / 1000)),
          };
        } catch (e) {
          warn('rate-limit check failed; allowing request', e);
          return { allowed: true, remaining: max, retryAfter: 0 };
        }
      },
    };
  }
  return {
    async check(key) {
      const k = `${name}:${key}`;
      const count = await memoryStore.incr(k, windowSeconds);
      if (count > max) return { allowed: false, remaining: 0, retryAfter: Math.max(1, await memoryStore.ttl(k)) };
      return { allowed: true, remaining: max - count, retryAfter: 0 };
    },
  };
}

/** Limits from the security spec. */
export const LIMITS = {
  portal:      { max: 30,  windowSeconds: 60 },        // per IP
  api:         { max: 100, windowSeconds: 60 },        // per user, or per IP when not logged in
  // Staff share an office IP, so a logged-in user is also held to a looser per-IP ceiling.
  apiPerIp:    { max: 600, windowSeconds: 60 },
  loginMax:    5,
  loginWindow: 15 * 60,
  loginLock:   15 * 60,
} as const;

let limiters: { portal: Limiter; api: Limiter; apiPerIp: Limiter } | null = null;
export function getLimiters() {
  limiters ??= {
    portal:   createLimiter('portal', LIMITS.portal.max, LIMITS.portal.windowSeconds),
    api:      createLimiter('api', LIMITS.api.max, LIMITS.api.windowSeconds),
    apiPerIp: createLimiter('api-ip', LIMITS.apiPerIp.max, LIMITS.apiPerIp.windowSeconds),
  };
  return limiters;
}

/** Test hook: forget cached clients and counters. */
export function _resetRateLimitForTests() {
  limiters = null;
  redis = undefined;
  memory.clear();
}

export function clientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    '127.0.0.1'
  );
}

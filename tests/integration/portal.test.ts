// @vitest-environment node
// Safer parent-portal links: hashed tokens, expiry, regenerate, PIN, view log, privacy headers.
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
let portal: typeof import('@/lib/portal');

beforeAll(async () => {
  process.env.NEXTAUTH_SECRET = 'test-secret-for-portal-cookies';
  process.env.NEXTAUTH_URL = 'https://pfuma.test';
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  portal = await import('@/lib/portal');
  A = await seedSchool(prisma, 'School A');
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

beforeEach(async () => {
  (await import('@/lib/rate-limit'))._resetRateLimitForTests();
});

const tokenOf = (url: string) => url.split('/portal/')[1];
const regenerate = async (as = A.users.BURSAR) => {
  const r = await call('portal-links/[id]', 'POST', { as, params: { id: A.studentId } });
  expect(r.status).toBe(200);
  return { url: r.json.data.portalUrl as string, token: tokenOf(r.json.data.portalUrl) };
};

describe('portal link generation', () => {
  it('creates a token of at least 32 random bytes and stores only its SHA-256 hash', async () => {
    const { url, token } = await regenerate();
    expect(url).toBe(`https://pfuma.test/portal/${token}`);
    expect(Buffer.from(token, 'base64url').length).toBeGreaterThanOrEqual(32);

    const row = await prisma.student.findUniqueOrThrow({ where: { id: A.studentId } });
    expect(row.portalTokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(row.portalToken).toBeNull();
    // The token appears nowhere in the stored row.
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.portalTokenCreatedAt).not.toBeNull();
  });

  it('expires at the end of the current academic year by default', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-15T09:00:00Z'));
      const r = await call('portal-links/[id]', 'POST', { as: A.users.HEAD, params: { id: A.studentId } });
      expect(new Date(r.json.data.expiresAt).toISOString()).toBe('2026-12-31T23:59:59.999Z');
      const row = await prisma.student.findUniqueOrThrow({ where: { id: A.studentId } });
      expect(row.portalTokenExpiresAt?.toISOString()).toBe('2026-12-31T23:59:59.999Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('regenerating invalidates the old link at once', async () => {
    const first = await regenerate();
    expect((await portal.lookupPortalToken(first.token)).status).toBe('ok');
    const second = await regenerate();
    expect(second.token).not.toBe(first.token);
    expect((await portal.lookupPortalToken(first.token)).status).toBe('invalid');
    expect((await portal.lookupPortalToken(second.token)).status).toBe('ok');
    expect(await prisma.auditLog.count({ where: { action: 'REGENERATE_PORTAL_LINK', entityId: A.studentId } })).toBeGreaterThanOrEqual(2);
  });

  it('only ADMIN, HEAD and BURSAR may regenerate', async () => {
    for (const role of ['ADMIN', 'HEAD', 'BURSAR'] as const) {
      expect((await call('portal-links/[id]', 'POST', { as: A.users[role], params: { id: A.studentId } })).status).toBe(200);
    }
    for (const role of ['DIRECTOR', 'TEACHER', 'LIBRARIAN'] as const) {
      expect((await call('portal-links/[id]', 'POST', { as: A.users[role], params: { id: A.studentId } })).status).toBe(403);
    }
    expect((await call('portal-links/[id]', 'POST', { as: null, params: { id: A.studentId } })).status).toBe(401);
  });
});

describe('looking a link up (public)', () => {
  it('rejects anything that is not one of our tokens without a database lookup', async () => {
    for (const bad of ['', 'short', 'x'.repeat(43) + '!', 'a'.repeat(200), '../../etc/passwd', "' OR 1=1 --"]) {
      expect((await portal.lookupPortalToken(bad)).status).toBe('invalid');
    }
  });

  it('a well-formed but unknown token is invalid', async () => {
    expect((await portal.lookupPortalToken(portal.generatePortalToken())).status).toBe('invalid');
  });

  it('the stored hash is not usable as a token', async () => {
    await regenerate();
    const row = await prisma.student.findUniqueOrThrow({ where: { id: A.studentId } });
    expect((await portal.lookupPortalToken(row.portalTokenHash!)).status).toBe('invalid');
  });

  it('refuses an expired link', async () => {
    const { token } = await regenerate();
    await prisma.student.update({ where: { id: A.studentId }, data: { portalTokenExpiresAt: new Date(Date.now() - 1000) } });
    expect((await portal.lookupPortalToken(token)).status).toBe('expired');
    await prisma.student.update({ where: { id: A.studentId }, data: { portalTokenExpiresAt: new Date(Date.now() + 86_400_000) } });
    expect((await portal.lookupPortalToken(token)).status).toBe('ok');
  });

  it('old plaintext links migrated to hashes keep working until they expire', async () => {
    const legacy = 'cmv9fsl4n00008q3uxx4xnhcb'; // 25-character cuid, as issued before the change
    await prisma.student.update({
      where: { id: A.studentId },
      data: { portalTokenHash: createHash('sha256').update(legacy).digest('hex'), portalTokenExpiresAt: new Date(Date.now() + 86_400_000) },
    });
    expect((await portal.lookupPortalToken(legacy)).status).toBe('ok');
    const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'; // crypto.randomUUID() style
    await prisma.student.update({ where: { id: A.studentId }, data: { portalTokenHash: createHash('sha256').update(uuid).digest('hex') } });
    expect((await portal.lookupPortalToken(uuid)).status).toBe('ok');
  });
});

describe('PIN', () => {
  it('is generated, stored hashed, returned once with a message for the guardian phone', async () => {
    const { token } = await regenerate();
    const r = await call('portal-links/[id]/pin', 'POST', { as: A.users.HEAD, params: { id: A.studentId } });
    expect(r.status).toBe(200);
    const { pin, guardianPhone, whatsappUrl, smsUrl } = r.json.data;
    expect(pin).toMatch(/^\d{4}$/);
    expect(guardianPhone).toBe('+263771234567');
    expect(whatsappUrl).toContain('wa.me/263771234567');
    expect(decodeURIComponent(whatsappUrl)).toContain(pin);
    expect(smsUrl).toContain('sms:+263771234567');

    const row = await prisma.student.findUniqueOrThrow({ where: { id: A.studentId } });
    expect(row.portalPinHash).not.toBe(pin);
    expect(await bcrypt.compare(pin, row.portalPinHash!)).toBe(true);
    expect(JSON.stringify(row)).not.toContain(`"${pin}"`);
    expect((await portal.lookupPortalToken(token)).status).toBe('ok');
  });

  it('cannot be set before a link exists', async () => {
    const s = await prisma.student.create({
      data: { schoolId: A.schoolId, admissionNumber: 'STU20269999', firstName: 'No', surname: 'Link', fullName: 'No Link', gender: 'F', admissionDate: new Date('2026-01-10') },
    });
    const r = await call('portal-links/[id]/pin', 'POST', { as: A.users.HEAD, params: { id: s.id } });
    expect(r.status).toBe(409);
  });

  it('is asked for once per device: a wrong PIN is refused, the right one sets a signed cookie', async () => {
    const { token } = await regenerate();
    const { pin } = (await call('portal-links/[id]/pin', 'POST', { as: A.users.HEAD, params: { id: A.studentId } })).json.data;
    const found = await portal.lookupPortalToken(token);
    if (found.status !== 'ok') throw new Error('expected ok');

    // Before the PIN is entered the device is not trusted.
    expect(portal.pinCookieValid(found.student, undefined)).toBe(false);
    expect(portal.pinCookieValid(found.student, 'forged-cookie')).toBe(false);

    const wrong = await call('portal/verify-pin', 'POST', { body: { token, pin: pin === '0000' ? '1111' : '0000' }, headers: { 'x-forwarded-for': '10.0.0.1' } });
    expect(wrong.status).toBe(403);
    expect(wrong.response.headers.get('set-cookie')).toBeNull();

    const right = await call('portal/verify-pin', 'POST', { body: { token, pin }, headers: { 'x-forwarded-for': '10.0.0.1' } });
    expect(right.status).toBe(200);
    const setCookie = right.response.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\/portal/i);
    const [name, value] = setCookie.split(';')[0].split('=');
    expect(name).toBe(portal.pinCookieName(found.student.portalTokenHash));
    expect(portal.pinCookieValid(found.student, value)).toBe(true);
  });

  it('a cookie stops working when the PIN or the link changes', async () => {
    const { token } = await regenerate();
    const { pin } = (await call('portal-links/[id]/pin', 'POST', { as: A.users.HEAD, params: { id: A.studentId } })).json.data;
    const ok = await call('portal/verify-pin', 'POST', { body: { token, pin }, headers: { 'x-forwarded-for': '10.0.0.2' } });
    const cookie = ok.response.headers.get('set-cookie')!.split(';')[0].split('=')[1];

    const before = await portal.lookupPortalToken(token);
    if (before.status !== 'ok') throw new Error('expected ok');
    expect(portal.pinCookieValid(before.student, cookie)).toBe(true);

    await call('portal-links/[id]/pin', 'POST', { as: A.users.HEAD, params: { id: A.studentId } }); // new PIN
    const afterPin = await portal.lookupPortalToken(token);
    if (afterPin.status !== 'ok') throw new Error('expected ok');
    expect(portal.pinCookieValid(afterPin.student, cookie)).toBe(false);
  });

  it('is limited: 5 wrong tries lock that IP for 15 minutes, even for the right PIN', async () => {
    const { token } = await regenerate();
    const { pin } = (await call('portal-links/[id]/pin', 'POST', { as: A.users.HEAD, params: { id: A.studentId } })).json.data;
    const wrongPin = pin === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++) {
      expect((await call('portal/verify-pin', 'POST', { body: { token, pin: wrongPin }, headers: { 'x-forwarded-for': '10.0.0.3' } })).status).toBe(403);
    }
    const locked = await call('portal/verify-pin', 'POST', { body: { token, pin }, headers: { 'x-forwarded-for': '10.0.0.3' } });
    expect(locked.status).toBe(429);
    expect(Number(locked.response.headers.get('retry-after'))).toBeGreaterThan(800);
    // Another address is not locked.
    expect((await call('portal/verify-pin', 'POST', { body: { token, pin }, headers: { 'x-forwarded-for': '10.0.0.4' } })).status).toBe(200);
  });

  it('is also limited per link across all addresses (20 wrong tries)', async () => {
    const { token } = await regenerate();
    const { pin } = (await call('portal-links/[id]/pin', 'POST', { as: A.users.HEAD, params: { id: A.studentId } })).json.data;
    const wrongPin = pin === '0000' ? '1111' : '0000';
    for (let i = 0; i < 20; i++) {
      await call('portal/verify-pin', 'POST', { body: { token, pin: wrongPin }, headers: { 'x-forwarded-for': `10.1.0.${i}` } });
    }
    expect((await call('portal/verify-pin', 'POST', { body: { token, pin }, headers: { 'x-forwarded-for': '10.1.9.9' } })).status).toBe(429);
  });

  it('rejects malformed PINs and links without a PIN', async () => {
    const { token } = await regenerate();
    await call('portal-links/[id]/pin', 'DELETE', { as: A.users.HEAD, params: { id: A.studentId } });
    expect((await call('portal/verify-pin', 'POST', { body: { token, pin: '1234' } })).status).toBe(404); // no PIN set
    expect((await call('portal/verify-pin', 'POST', { body: { token, pin: '12' } })).status).toBe(422);
    expect((await call('portal/verify-pin', 'POST', { body: { token: 'nonsense', pin: '1234' } })).status).toBe(404);
  });

  it('removing the PIN lets the link open without one', async () => {
    const { token } = await regenerate();
    await call('portal-links/[id]/pin', 'POST', { as: A.users.HEAD, params: { id: A.studentId } });
    const del = await call('portal-links/[id]/pin', 'DELETE', { as: A.users.HEAD, params: { id: A.studentId } });
    expect(del.status).toBe(200);
    const found = await portal.lookupPortalToken(token);
    if (found.status !== 'ok') throw new Error('expected ok');
    expect(found.student.portalPinHash).toBeNull();
    expect(portal.pinCookieValid(found.student, undefined)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'SET_PORTAL_PIN', entityId: A.studentId } })).toBeGreaterThanOrEqual(2);
  });
});

describe('view log', () => {
  it('records each view (student, time, IP) and shows the latest to staff', async () => {
    await regenerate();
    await portal.recordPortalView(A.studentId, A.schoolId, '41.1.1.1', 'Mozilla/5.0');
    await portal.recordPortalView(A.studentId, A.schoolId, '41.2.2.2', null);
    const rows = await prisma.portalAccessLog.findMany({ where: { studentId: A.studentId }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.ip)).toEqual(['41.1.1.1', '41.2.2.2']);
    expect(rows[0].schoolId).toBe(A.schoolId);

    const info = await call('portal-links/[id]', 'GET', { as: A.users.BURSAR, params: { id: A.studentId } });
    expect(info.status).toBe(200);
    expect(info.json.data.views.map((v: { ip: string }) => v.ip)).toEqual(['41.2.2.2', '41.1.1.1']); // newest first
    expect(info.json.data.hasLink).toBe(true);
  });

  it('never fails the page because the log could not be written', async () => {
    await expect(portal.recordPortalView('no-such-student', A.schoolId, '1.1.1.1', null)).resolves.toBeUndefined();
  });
});

describe('privacy headers', () => {
  it('portal pages are noindex and send no referrer', async () => {
    const page = await import('@/app/portal/[token]/page');
    expect(page.metadata.robots).toMatchObject({ index: false, follow: false });
    expect(page.metadata.referrer).toBe('no-referrer');

    const config = (await import('../../next.config.mjs')).default as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
    const rules = await config.headers();
    const rule = rules.find((r) => r.source === '/portal/:path*');
    expect(rule).toBeDefined();
    const h = Object.fromEntries(rule!.headers.map((x) => [x.key, x.value]));
    expect(h['Referrer-Policy']).toBe('no-referrer');
    expect(h['X-Robots-Tag']).toMatch(/noindex/);
  });
});

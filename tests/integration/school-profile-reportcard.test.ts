// @vitest-environment node
// The school profile reaches the report card: head's name, and logo / signature when they load.
// A logo or signature that cannot be loaded must never stop a report card from being made.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;

// A real 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

beforeAll(async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.$disconnect();
  await t.stop();
});

// Only the school's image addresses are faked; everything else (the PDF engine loads files too) goes through.
const realFetch = globalThis.fetch;
const fake = (handler: (url: string) => Promise<Response>) =>
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return /utfs.io|ufs.sh|evil.example|169.254/.test(url) ? handler(url) : realFetch(input, init);
  });

const report = () => call('results/reports/[studentId]', 'GET', { as: A.users.HEAD, params: { studentId: A.studentId }, query: `?termId=${A.termId}` });

describe('report card with the school profile', () => {
  it('is made with the head, logo and signature when they load', async () => {
    await prisma.school.update({
      where: { id: A.schoolId },
      data: { motto: 'Strive', headName: 'Mrs T. Moyo', logoUrl: 'https://utfs.io/f/logo.png', headSignatureUrl: 'https://abc123.ufs.sh/f/sign.png' },
    });
    const calls: string[] = [];
    fake(async (url) => {
      calls.push(url);
      return new Response(new Uint8Array(PNG), { status: 200, headers: { 'content-type': 'image/png' } });
    });
    const r = await report();
    expect(r.status).toBe(200);
    expect(r.response.headers.get('content-type')).toBe('application/pdf');
    expect(r.text.startsWith('%PDF')).toBe(true);
    expect(calls.sort()).toEqual(['https://abc123.ufs.sh/f/sign.png', 'https://utfs.io/f/logo.png']);
    vi.unstubAllGlobals();
  });

  it('is still made when the images cannot be loaded', async () => {
    fake(async () => { throw new Error('network down'); });
    const r = await report();
    expect(r.status).toBe(200);
    expect(r.text.startsWith('%PDF')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('is still made when the host sends something that is not an image', async () => {
    fake(async () => new Response('<html>nope</html>', { status: 200, headers: { 'content-type': 'image/png' } }));
    const r = await report();
    expect(r.status).toBe(200);
    expect(r.text.startsWith('%PDF')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('never fetches an address that is not an upload', async () => {
    await prisma.school.update({ where: { id: A.schoolId }, data: { logoUrl: 'https://evil.example/pixel.png', headSignatureUrl: 'http://169.254.169.254/latest/meta-data' } });
    const calls: string[] = [];
    fake(async (url) => { calls.push(url); return new Response('x'); });
    const r = await report();
    expect(r.status).toBe(200);
    expect(calls).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('is made for a school that has filled in nothing', async () => {
    await prisma.school.update({ where: { id: A.schoolId }, data: { motto: null, headName: null, logoUrl: null, headSignatureUrl: null } });
    const r = await report();
    expect(r.status).toBe(200);
    expect(r.text.startsWith('%PDF')).toBe(true);
  });
});

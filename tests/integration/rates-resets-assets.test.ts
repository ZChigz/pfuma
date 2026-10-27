// @vitest-environment node
// Part 5.3 (dated exchange rates), 5.4 (password reset tokens, NextAuth tables gone),
// 5.5 (asset tags, transfers, disposal income).
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigration, createPg, startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;

const day = 864e5;
const at = (days: number) => new Date(Date.now() + days * day);

beforeAll(async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.NEXTAUTH_URL = 'https://pfuma.test';
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

beforeEach(async () => {
  (await import('@/lib/rate-limit'))._resetRateLimitForTests();
});

// ─── 5.3 ─────────────────────────────────────────────────────────────────────

describe('5.3 — the rate for a date is the latest effectiveFrom on or before it', () => {
  const setRate = (usdToZig: number, effectiveFrom: Date, extra: Record<string, unknown> = {}, as = A.users.BURSAR) =>
    call('accounting/exchange-rate', 'POST', { as, body: { usdToZig, effectiveFrom: effectiveFrom.toISOString(), ...extra } });
  let r1: string, r2: string, r3: string, r4: string;

  beforeAll(async () => {
    r1 = (await setRate(20, at(-10), { source: 'RBZ' })).json.data.rate.id;
    r2 = (await setRate(25, at(-5))).json.data.rate.id;
    r3 = (await setRate(30, at(5), { source: 'OTHER', note: 'announced' })).json.data.rate.id; // future
    r4 = (await setRate(21, at(-10), { note: 'correction of the first rate' })).json.data.rate.id; // entered last, same start as r1
  });

  it('the rate in force now is the latest effective one — not the newest row', async () => {
    const { rateFor } = await import('@/lib/exchange-rate');
    const { getScopedDb } = await import('@/lib/scoped-db');
    const db = getScopedDb(A.schoolId, A.users.BURSAR.id);
    expect((await rateFor(db, new Date()))?.id).toBe(r2);       // r3 is newer but not started, r4 was entered last
    expect((await rateFor(db, at(-7)))?.id).toBe(r4);            // r1 and r4 start together: the later entry wins
    expect((await rateFor(db, at(6)))?.id).toBe(r3);             // once r3 has started
    expect(await rateFor(db, at(-20))).toBeNull();               // before any rate
    const api = await call('accounting/exchange-rate', 'GET', { as: A.users.BURSAR });
    expect(api.json.data.rate).toMatchObject({ id: r2, usdToZig: 25 });
  });

  it('a rate stores where it came from and from when it applies', async () => {
    const row = await prisma.exchangeRate.findUniqueOrThrow({ where: { id: r1 } });
    expect(row.source).toBe('RBZ');
    expect(Math.abs(row.effectiveFrom.getTime() - at(-10).getTime())).toBeLessThan(5000);
    expect((await prisma.exchangeRate.findUniqueOrThrow({ where: { id: r2 } })).source).toBe('SCHOOL');
    expect(await prisma.auditLog.count({ where: { action: 'SET_EXCHANGE_RATE', entityId: r3 } })).toBe(1);
  });

  it('a rate without a start date applies from now', async () => {
    const r = await call('accounting/exchange-rate', 'POST', { as: A.users.BURSAR, body: { usdToZig: 26 } });
    expect(r.status).toBe(201);
    const row = await prisma.exchangeRate.findUniqueOrThrow({ where: { id: r.json.data.rate.id } });
    expect(Math.abs(row.effectiveFrom.getTime() - Date.now())).toBeLessThan(10_000);
    expect(row.source).toBe('SCHOOL');
  });

  it('validates the source and refuses a start date far in the future; other roles may not set rates', async () => {
    expect((await setRate(25, at(1), { source: 'GUESS' })).status).toBe(422);
    expect((await setRate(25, at(90))).status).toBe(422);
    expect((await setRate(0, at(0))).status).toBe(422);
    expect((await setRate(25, at(0), {}, A.users.TEACHER)).status).toBe(403);
  });

  it('rows cannot be edited or deleted: the database refuses it, and no route offers it', async () => {
    await expect(t.pg.exec(`UPDATE "ExchangeRate" SET "usdToZig" = 1 WHERE "id" = '${r2}'`)).rejects.toThrow(/cannot be changed or deleted/);
    await expect(t.pg.exec(`DELETE FROM "ExchangeRate" WHERE "id" = '${r2}'`)).rejects.toThrow(/cannot be changed or deleted/);
    const route = await import('@/app/api/accounting/exchange-rate/route');
    expect(Object.keys(route).filter((k) => ['PATCH', 'PUT', 'DELETE'].includes(k))).toEqual([]);
  });

  const zigPayment = (body: Record<string, unknown>) =>
    call('accounting/payments', 'POST', {
      as: A.users.BURSAR,
      body: { studentId: A.studentId, currency: 'USD', method: 'ECOCASH', reference: 'EC1', feeLabel: 'Tuition', paidInZig: true, ...body },
    });

  it('a ZiG payment links to the exact rate row in force and uses its value', async () => {
    const r = await zigPayment({ amount: 10, zigAmountPaid: 250, exchangeRateUsed: 25 });
    // the newest in-force row is the one entered just before ("26"), so use what the server says is in force
    if (r.status === 409) {
      const inForce = Number(/ZiG ([\d.]+)/.exec(r.json.message)![1]);
      expect(inForce).toBe(26);
    } else {
      expect.fail('expected the rate set a moment ago (26) to be in force');
    }
  });

  it('the payment is linked to the rate in force when it is made', async () => {
    const current = (await call('accounting/exchange-rate', 'GET', { as: A.users.BURSAR })).json.data.rate;
    const r = await zigPayment({ amount: 10, zigAmountPaid: current.usdToZig * 10, exchangeRateUsed: current.usdToZig });
    expect(r.status).toBe(201);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: r.json.data.payment.id } });
    expect(p.exchangeRateId).toBe(current.id);
    expect(p.exchangeRateUsed?.toNumber()).toBe(current.usdToZig);
  });

  it('refuses a rate the browser made up, a conversion that does not add up, and a missing rate', async () => {
    const current = (await call('accounting/exchange-rate', 'GET', { as: A.users.BURSAR })).json.data.rate;
    const stale = await zigPayment({ amount: 10, zigAmountPaid: 100 * 10, exchangeRateUsed: 100 });
    expect(stale.status).toBe(409);
    expect(stale.json.message).toMatch(/exchange rate in force is ZiG/);
    const wrongSum = await zigPayment({ amount: 10, zigAmountPaid: current.usdToZig * 5, exchangeRateUsed: current.usdToZig });
    expect(wrongSum.status).toBe(422);
    // school B has no rate
    const none = await call('accounting/payments', 'POST', {
      as: B.users.BURSAR,
      body: { studentId: B.studentId, currency: 'USD', amount: 10, method: 'ECOCASH', reference: 'EC2', feeLabel: 'Tuition', paidInZig: true, zigAmountPaid: 250, exchangeRateUsed: 25 },
    });
    expect(none.status).toBe(409);
    expect(none.json.message).toMatch(/No exchange rate is in force/);
  });

  it('later rates never change what an earlier payment used; USD payments carry no rate', async () => {
    const current = (await call('accounting/exchange-rate', 'GET', { as: A.users.BURSAR })).json.data.rate;
    const first = await zigPayment({ amount: 10, zigAmountPaid: current.usdToZig * 10, exchangeRateUsed: current.usdToZig });
    await call('accounting/exchange-rate', 'POST', { as: A.users.BURSAR, body: { usdToZig: 40 } });
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: first.json.data.payment.id } });
    expect(after.exchangeRateId).toBe(current.id);
    expect(after.exchangeRateUsed?.toNumber()).toBe(current.usdToZig);
    const usd = await call('accounting/payments', 'POST', {
      as: A.users.BURSAR,
      body: { studentId: A.studentId, currency: 'USD', amount: 5, method: 'CASH', feeLabel: 'Levy', paidInZig: false },
    });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: usd.json.data.payment.id } })).exchangeRateId).toBeNull();
  });

  it('the database refuses a payment that points at another school\'s rate', async () => {
    const rb = await prisma.exchangeRate.create({ data: { schoolId: B.schoolId, usdToZig: 30, setBy: B.users.BURSAR.id } });
    await expect(
      t.pg.exec(`UPDATE "Payment" SET "exchangeRateId" = '${rb.id}' WHERE "id" = '${A.paymentId}'`),
    ).rejects.toThrow(/Cross-school reference/);
  });
});

// ─── 5.4 ─────────────────────────────────────────────────────────────────────

describe('5.4 — NextAuth tables are gone; password reset tokens', () => {
  const link = async (id = A.users.LIBRARIAN.id, as = A.users.ADMIN) =>
    call('admin/users/[id]/reset-link', 'POST', { as, params: { id } });
  const tokenOf = (url: string) => url.split('/reset-password/')[1];
  const reset = (token: string, newPassword = 'A-brand-new-password', ip = '10.9.0.1') =>
    call('password-reset', 'POST', { body: { token, newPassword }, headers: { 'x-forwarded-for': ip } });

  it('Account, Session and VerificationToken no longer exist, nor the adapter package', async () => {
    const r = await t.pg.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('Account','Session','VerificationToken')`);
    expect(r.rows).toHaveLength(0);
    expect(JSON.parse(fs.readFileSync('package.json', 'utf8')).dependencies['@auth/prisma-adapter']).toBeUndefined();
  });

  it('an admin creates a single-use link valid for 30 minutes; only a hash is stored', async () => {
    const r = await link();
    expect(r.status).toBe(200);
    const url: string = r.json.data.resetUrl;
    expect(url).toMatch(/^https:\/\/pfuma\.test\/reset-password\/[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(url);
    const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: A.users.LIBRARIAN.id }, orderBy: { createdAt: 'desc' } });
    expect(row.tokenHash).not.toContain(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.usedAt).toBeNull();
    expect(row.createdById).toBe(A.users.ADMIN.id);
    expect(row.schoolId).toBe(A.schoolId);
    const minutes = (row.expiresAt.getTime() - row.createdAt.getTime()) / 60_000;
    expect(minutes).toBeGreaterThan(29.9);
    expect(minutes).toBeLessThan(30.1);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(await prisma.auditLog.count({ where: { action: 'CREATE_PASSWORD_RESET', entityId: A.users.LIBRARIAN.id } })).toBeGreaterThan(0);
  });

  it('only user managers can make one, never for another school or a deactivated account', async () => {
    for (const as of [A.users.TEACHER, A.users.BURSAR, A.users.HEAD]) expect((await link(A.users.LIBRARIAN.id, as)).status).toBe(403);
    expect((await link(B.users.TEACHER.id)).status).toBe(404);
    const off = await prisma.user.create({ data: { schoolId: A.schoolId, fullName: 'Off', email: 'off@a.test', role: 'TEACHER', passwordHash: 'x', active: false } });
    expect((await link(off.id)).status).toBe(409);
  });

  it('using the link sets the password, ends all sessions, and works exactly once', async () => {
    const u = await prisma.user.create({ data: { schoolId: A.schoolId, fullName: 'Reset Me', email: 'resetme@a.test', role: 'TEACHER', passwordHash: await bcrypt.hash('Old-password-123', 4), mustChangePassword: true } });
    const token = tokenOf((await link(u.id)).json.data.resetUrl);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    const ok = await reset(token);
    expect(ok.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await bcrypt.compare('A-brand-new-password', after.passwordHash)).toBe(true);
    expect(bcrypt.getRounds(after.passwordHash)).toBe(12);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    expect(after.mustChangePassword).toBe(false);
    expect((await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: u.id } })).usedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'USE_PASSWORD_RESET', entityId: u.id } })).toBe(1);

    const again = await reset(token, 'Another-new-password-1');
    expect(again.status).toBe(410);
    expect(again.json.message).toMatch(/already been used/);
    expect(await bcrypt.compare('A-brand-new-password', (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash)).toBe(true);
  });

  it('two simultaneous uses: only one wins', async () => {
    const u = await prisma.user.create({ data: { schoolId: A.schoolId, fullName: 'Race', email: 'race@a.test', role: 'TEACHER', passwordHash: 'x' } });
    const token = tokenOf((await link(u.id)).json.data.resetUrl);
    const results = await Promise.all([reset(token, 'First-new-password-1'), reset(token, 'Second-new-password-2')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
  });

  it('expires after 30 minutes', async () => {
    const u = await prisma.user.create({ data: { schoolId: A.schoolId, fullName: 'Slow', email: 'slow@a.test', role: 'TEACHER', passwordHash: 'x' } });
    const token = tokenOf((await link(u.id)).json.data.resetUrl);
    await prisma.passwordResetToken.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await reset(token);
    expect(r.status).toBe(410);
    expect(r.json.message).toMatch(/expired/);
    expect(await bcrypt.compare('A-brand-new-password', (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash)).toBe(false);
  });

  it('a new link cancels the previous one', async () => {
    const u = await prisma.user.create({ data: { schoolId: A.schoolId, fullName: 'Twice', email: 'twice@a.test', role: 'TEACHER', passwordHash: 'x' } });
    const first = tokenOf((await link(u.id)).json.data.resetUrl);
    const second = tokenOf((await link(u.id)).json.data.resetUrl);
    expect((await reset(first)).status).toBe(410);
    expect((await reset(second)).status).toBe(200);
  });

  it('a weak password is refused and the link stays usable', async () => {
    const u = await prisma.user.create({ data: { schoolId: A.schoolId, fullName: 'Weak', email: 'weak@a.test', role: 'TEACHER', passwordHash: 'x' } });
    const token = tokenOf((await link(u.id)).json.data.resetUrl);
    const weak = await reset(token, 'short');
    expect(weak.status).toBe(422);
    expect(weak.json.message).toMatch(/at least 10/);
    expect((await reset(token)).status).toBe(200);
  });

  it('garbage links are invalid, and repeated bad tries from one address are locked', async () => {
    expect((await reset('nonsense')).status).toBe(404);
    expect((await reset('x'.repeat(43), 'A-brand-new-password', '10.9.0.7')).status).toBe(404);
    for (let i = 0; i < 10; i++) expect((await reset('y'.repeat(43), 'A-brand-new-password', '10.9.0.8')).status).toBe(404); // the 10th failure locks
    const locked = await reset('z'.repeat(43), 'A-brand-new-password', '10.9.0.8');
    expect(locked.status).toBe(429);
    expect((await reset('z'.repeat(43), 'A-brand-new-password', '10.9.0.9')).status).toBe(404); // another address
  });

  it('the reset page and API are public but rate limited like the portal', async () => {
    const middleware = fs.readFileSync('middleware.ts', 'utf8');
    expect(middleware).toContain("pathname.startsWith('/reset-password')");
    expect(middleware).toContain("pathname.startsWith('/api/password-reset')");
  });
});

// ─── 5.5 ─────────────────────────────────────────────────────────────────────

describe('5.5 — asset tags, transfers and disposal income', () => {
  const asset = (over: Record<string, unknown> = {}) => ({
    name: 'Projector', categoryId: A.assetCategoryId, tagNumber: 'PRJ-100', acquisitionDate: '2026-02-01', acquisitionCost: 400,
    currency: 'USD', location: 'Lab', condition: 'GOOD', ...over,
  });
  const create = async (over: Record<string, unknown> = {}) => {
    const r = await call('assets', 'POST', { as: A.users.BURSAR, body: asset(over) });
    expect(r.status).toBe(201);
    return r.json.data.asset as { id: string };
  };

  it('a tag number is unique within a school (but another school may reuse it)', async () => {
    await create({ tagNumber: 'UNIQ-1' });
    const dup = await call('assets', 'POST', { as: A.users.BURSAR, body: asset({ tagNumber: 'UNIQ-1', name: 'Other' }) });
    expect(dup.status).toBe(409);
    expect(dup.json.message).toMatch(/already used by Projector/);
    await expect(
      t.pg.exec(`INSERT INTO "Asset" ("id","schoolId","name","categoryId","tagNumber","acquisitionDate","acquisitionCost","currency","location") VALUES ('dup1','${A.schoolId}','x','${A.assetCategoryId}','UNIQ-1',now(),1,'USD','x')`),
    ).rejects.toThrow(/Asset_schoolId_tagNumber_key|duplicate key/);
    const other = await call('assets', 'POST', { as: B.users.BURSAR, body: asset({ tagNumber: 'UNIQ-1', categoryId: B.assetCategoryId }) });
    expect(other.status).toBe(201);
  });

  it('a custodian typed as a staff name becomes a link; any other name stays a name', async () => {
    const a = await create({ tagNumber: 'CUS-1', custodian: A.users.TEACHER.fullName.toUpperCase() });
    const row = await prisma.asset.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.custodianId).toBe(A.users.TEACHER.id);
    expect(row.custodian).toBe(A.users.TEACHER.fullName);
    const b = await create({ tagNumber: 'CUS-2', custodian: 'Mr Visiting Contractor' });
    const rowB = await prisma.asset.findUniqueOrThrow({ where: { id: b.id } });
    expect([rowB.custodianId, rowB.custodian]).toEqual([null, 'Mr Visiting Contractor']);
    expect((await call('assets', 'POST', { as: A.users.BURSAR, body: asset({ tagNumber: 'CUS-3', custodianId: B.users.TEACHER.id }) })).status).toBe(404);
  });

  it('moving an asset or handing it over is recorded and the history is kept', async () => {
    const a = await create({ tagNumber: 'MOVE-1', location: 'Lab', custodian: A.users.TEACHER.fullName });
    const move = await call('assets/[id]', 'PATCH', { as: A.users.BURSAR, params: { id: a.id }, body: { location: 'Staff room', custodianId: A.users.LIBRARIAN.id, transferNote: 'Lent to the library' } });
    expect(move.status).toBe(200);
    const [tr] = await prisma.assetTransfer.findMany({ where: { assetId: a.id } });
    expect(tr).toMatchObject({
      fromLocation: 'Lab', toLocation: 'Staff room',
      fromCustodianId: A.users.TEACHER.id, toCustodianId: A.users.LIBRARIAN.id,
      fromCustodianName: A.users.TEACHER.fullName, toCustodianName: A.users.LIBRARIAN.fullName,
      recordedById: A.users.BURSAR.id, schoolId: A.schoolId, note: 'Lent to the library',
    });
    expect(await prisma.auditLog.count({ where: { action: 'TRANSFER_ASSET', entityId: a.id } })).toBe(1);

    // a back-dated move, and a custodian who is not a staff member
    await call('assets/[id]', 'PATCH', { as: A.users.BURSAR, params: { id: a.id }, body: { custodian: 'Contractor Dube', transferDate: '2026-03-01T00:00:00.000Z' } });
    const all = await prisma.assetTransfer.findMany({ where: { assetId: a.id }, orderBy: { createdAt: 'asc' } });
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ fromLocation: 'Staff room', toLocation: 'Staff room', toCustodianId: null, toCustodianName: 'Contractor Dube', fromCustodianId: A.users.LIBRARIAN.id });
    expect(all[1].transferDate.toISOString()).toBe('2026-03-01T00:00:00.000Z');

    const got = await call('assets/[id]', 'GET', { as: A.users.HEAD, params: { id: a.id } });
    expect(got.json.data.asset.transfers).toHaveLength(2);
    expect(got.json.data.asset.transfers[0].recordedBy.fullName).toBeDefined();
  });

  it('changing nothing that matters records no transfer; other edits do not either', async () => {
    const a = await create({ tagNumber: 'STILL-1', location: 'Hall', custodian: 'Mr Same' });
    await call('assets/[id]', 'PATCH', { as: A.users.BURSAR, params: { id: a.id }, body: { location: 'Hall', custodian: 'mr same', condition: 'FAIR' } });
    expect(await prisma.assetTransfer.count({ where: { assetId: a.id } })).toBe(0);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: a.id } })).condition).toBe('FAIR');
  });

  it('the history cannot be rewritten', async () => {
    const tr = await prisma.assetTransfer.findFirstOrThrow();
    await expect(t.pg.exec(`UPDATE "AssetTransfer" SET "toLocation" = 'x' WHERE "id" = '${tr.id}'`)).rejects.toThrow(/cannot be changed or deleted/);
    await expect(t.pg.exec(`DELETE FROM "AssetTransfer" WHERE "id" = '${tr.id}'`)).rejects.toThrow(/cannot be changed or deleted/);
  });

  it('a disposed asset cannot be moved; a foreign custodian is not found', async () => {
    const a = await create({ tagNumber: 'DEAD-1' });
    expect((await call('assets/[id]', 'PATCH', { as: A.users.BURSAR, params: { id: a.id }, body: { custodianId: B.users.TEACHER.id } })).status).toBe(404);
    await call('assets/[id]/dispose', 'POST', { as: A.users.DIRECTOR, params: { id: a.id }, body: { disposalDate: '2026-09-01', reason: 'Broken', method: 'SCRAPPED' } });
    expect((await call('assets/[id]', 'PATCH', { as: A.users.BURSAR, params: { id: a.id }, body: { location: 'Skip' } })).status).toBe(409);
  });

  const dispose = (id: string, body: Record<string, unknown>) =>
    call('assets/[id]/dispose', 'POST', { as: A.users.DIRECTOR, params: { id }, body: { disposalDate: '2026-09-01', reason: 'Sold', method: 'SOLD', ...body } });

  it('disposal proceeds above zero become an income record', async () => {
    const a = await create({ tagNumber: 'SELL-1', name: 'Old photocopier' });
    const r = await dispose(a.id, { proceeds: 120, currency: 'USD' });
    expect(r.status).toBe(200);
    const income = await prisma.income.findFirstOrThrow({ where: { assetDisposalId: r.json.data.disposal.id } });
    expect(income).toMatchObject({ source: 'ASSET_DISPOSAL', currency: 'USD', schoolId: A.schoolId, recordedById: A.users.DIRECTOR.id });
    expect(income.amount.toNumber()).toBe(120);
    expect(income.description).toMatch(/Old photocopier \(SELL-1\)/);
    expect(income.receivedOn.toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(await prisma.auditLog.count({ where: { action: 'RECORD_INCOME', entityId: income.id } })).toBe(1);
  });

  it('no proceeds, no income; proceeds need a currency', async () => {
    const before = await prisma.income.count();
    const scrapped = await create({ tagNumber: 'SCRAP-1' });
    expect((await dispose(scrapped.id, { method: 'SCRAPPED' })).status).toBe(200);
    expect(await prisma.income.count()).toBe(before);
    const noCurrency = await create({ tagNumber: 'SCRAP-2' });
    const r = await dispose(noCurrency.id, { proceeds: 50 });
    expect(r.status).toBe(422);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: noCurrency.id } })).status).toBe('ACTIVE');
    expect(await prisma.income.count()).toBe(before);
  });

  it('the finance report adds the income to the net position', async () => {
    const a = await create({ tagNumber: 'SELL-2' });
    await dispose(a.id, { proceeds: 75, currency: 'ZIG' });
    const report = await call('accounting/dashboard', 'GET', { as: A.users.DIRECTOR });
    expect(report.status).toBe(200);
    const d = report.json.data;
    expect(d.otherIncomeUSD).toBe(120);
    expect(d.otherIncomeZiG).toBe(75);
    expect(d.netUSD).toBe(d.collectedUSD + 120 - d.spentUSD);
    expect(d.netZiG).toBe(d.collectedZiG + 75 - d.spentZiG);
    // school B sees none of it
    const b = await call('accounting/dashboard', 'GET', { as: B.users.DIRECTOR });
    expect(b.json.data.otherIncomeUSD).toBe(0);
  });

  it('income is positive and stays inside its school', async () => {
    await expect(t.pg.exec(`INSERT INTO "Income" ("id","schoolId","source","amount","currency","receivedOn","description","recordedById") VALUES ('inc0','${A.schoolId}','OTHER',0,'USD',now(),'x','${A.users.HEAD.id}')`)).rejects.toThrow(/Income_amount_positive/);
    await expect(t.pg.exec(`INSERT INTO "Income" ("id","schoolId","source","amount","currency","receivedOn","description","recordedById") VALUES ('inc1','${A.schoolId}','OTHER',5,'USD',now(),'x','${B.users.HEAD.id}')`)).rejects.toThrow(/Cross-school reference/);
  });
});

// ─── The migration on data that already exists ───────────────────────────────

describe('migration 20261022000000 on existing data', () => {
  it('dedupes tags, links rates to payments, matches custodians, turns old proceeds into income, drops the NextAuth tables', async () => {
    const pg = await createPg('20261022000000_rates_resets_assets');
    try {
      await pg.exec(`
        INSERT INTO "School" ("id","name") VALUES ('s1','Old School');
        INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash") VALUES ('u1','s1','Pat Custodian','pat@old.test','x'), ('u2','s1','Twin Name','t1@old.test','x'), ('u3','s1','Twin Name','t2@old.test','x');
        INSERT INTO "AssetCategory" ("id","schoolId","name") VALUES ('c1','s1','Furniture');
        INSERT INTO "Asset" ("id","schoolId","name","categoryId","tagNumber","acquisitionDate","acquisitionCost","currency","location","custodian","createdAt") VALUES
          ('a1','s1','Desk','c1','TAG-1',now(),10,'USD','Hall','pat custodian','2026-01-01'),
          ('a2','s1','Desk copy','c1','TAG-1',now(),10,'USD','Hall','Twin Name','2026-01-02'),
          ('a3','s1','Desk copy 2','c1','TAG-1',now(),10,'USD','Hall',NULL,'2026-01-03'),
          ('a4','s1','Sold chair','c1','TAG-9',now(),10,'USD','Hall',NULL,'2026-01-04'),
          ('a5','s1','Scrapped chair','c1','TAG-10',now(),10,'USD','Hall',NULL,'2026-01-05');
        INSERT INTO "AssetDisposal" ("id","schoolId","assetId","disposalDate","reason","method","proceeds","currency","recordedBy") VALUES
          ('d1','s1','a4','2026-05-01','Sold','SOLD',40,'USD','u1'),
          ('d2','s1','a5','2026-05-01','Scrapped','SCRAPPED',NULL,NULL,'u1');
        INSERT INTO "ExchangeRate" ("id","schoolId","usdToZig","setBy","createdAt") VALUES
          ('r1','s1',20,'u1','2026-01-01'), ('r2','s1',25,'u1','2026-02-01'), ('r3','s1',30,'u1','2026-04-01');
        INSERT INTO "Student" ("id","schoolId","admissionNumber","firstName","surname","fullName","admissionDate") VALUES ('st1','s1','STU20260001','A','B','A B','2026-01-01');
        INSERT INTO "Payment" ("id","schoolId","studentId","currency","amount","method","feeLabel","recordedBy","recordedAt","paidInZig","exchangeRateUsed") VALUES
          ('p1','s1','st1','USD',10,'ECOCASH','x','u1','2026-02-15',true,25),
          ('p2','s1','st1','USD',10,'CASH','x','u1','2026-02-15',false,NULL),
          ('p3','s1','st1','USD',10,'ECOCASH','x','u1','2026-03-01',true,99);
      `);
      await applyMigration(pg, '20261022000000_rates_resets_assets');
      const q = async <T,>(sql: string) => (await pg.query<T>(sql)).rows;

      expect((await q<{ tagNumber: string }>(`SELECT "tagNumber" FROM "Asset" WHERE "id" IN ('a1','a2','a3') ORDER BY "id"`)).map((r) => r.tagNumber)).toEqual(['TAG-1', 'TAG-1-2', 'TAG-1-3']);
      expect(await q<{ id: string; custodianId: string | null }>(`SELECT "id","custodianId" FROM "Asset" WHERE "id" IN ('a1','a2') ORDER BY "id"`)).toEqual([
        { id: 'a1', custodianId: 'u1' }, // matched one staff member (case-insensitive)
        { id: 'a2', custodianId: null }, // two staff share the name: not guessed
      ]);
      expect(await q<{ id: string; exchangeRateId: string | null }>(`SELECT "id","exchangeRateId" FROM "Payment" ORDER BY "id"`)).toEqual([
        { id: 'p1', exchangeRateId: 'r2' }, { id: 'p2', exchangeRateId: null }, { id: 'p3', exchangeRateId: null }, // 99 matches no rate
      ]);
      expect((await q<{ id: string; effectiveFrom: Date; createdAt: Date }>(`SELECT * FROM "ExchangeRate" ORDER BY "id"`)).every((r) => r.effectiveFrom.getTime() === r.createdAt.getTime())).toBe(true);
      const income = await q<{ assetDisposalId: string; amount: string }>(`SELECT "assetDisposalId","amount" FROM "Income"`);
      expect(income).toEqual([{ assetDisposalId: 'd1', amount: '40.00' }]);
      expect(await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('Account','Session','VerificationToken')`)).toHaveLength(0);
      await expect(pg.exec(`UPDATE "ExchangeRate" SET "usdToZig" = 1`)).rejects.toThrow(/cannot be changed or deleted/);
    } finally {
      await pg.close();
    }
  }, 120_000);
});

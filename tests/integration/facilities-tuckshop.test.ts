// @vitest-environment node
// Pocket money and the tuck shop against a real PostgreSQL: a deposit is a Finance payment into the pocket-money fund (never used against
// a fee, which the database refuses), a wallet is never overdrawn and holds one currency, the weekly limit and low-balance alert work,
// stock leaves the Tuck shop store, a sale sent twice counts once, the cash-up is confirmed by someone else, and the wallets together
// match what was paid into the fund.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, userWithRoles, type SeededSchool } from '../helpers/seed';
import { actorOf } from '../helpers/academics';
import { addStudent } from '../helpers/students';
import { fails } from '../helpers/finance';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

type Actor = Awaited<ReturnType<typeof actorOf>>;
let t: TestDb;
let prisma: typeof import('@/lib/prisma').prisma;
let tuck: typeof import('@/lib/facilities/tuckshop');
let inv: typeof import('@/lib/facilities/inventory');
let payments: typeof import('@/lib/finance/payments');
let A: SeededSchool; let B: SeededSchool;
let op: Actor; let bm: Actor; let bm2: Actor; let plain: Actor; let opB: Actor;
const kid: Record<string, string> = {};
const item: Record<string, string> = {};
let sale1: string;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  [tuck, inv, payments] = await Promise.all([import('@/lib/facilities/tuckshop'), import('@/lib/facilities/inventory'), import('@/lib/finance/payments')]);
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  await prisma.finSettings.create({ data: { schoolId: A.schoolId, legacyRetired: true } });
  const bmU = await userWithRoles(prisma, A, ['BOARDING_MASTER'], 'bm');
  const bm2U = await userWithRoles(prisma, A, ['BOARDING_MASTER'], 'bm2');
  const plainU = await userWithRoles(prisma, A, ['TEACHER'], 'plain');
  for (const [k, n, b] of [['amy', 'Amy', 'BOARDER'], ['ben', 'Ben', 'BOARDER'], ['day', 'Dayo', 'DAY']] as const) kid[k] = (await addStudent(prisma, A, { firstName: n, surname: 'Learner', gender: 'M', boarding: b })).id;
  kid.other = (await addStudent(prisma, B, { firstName: 'Other', surname: 'School', gender: 'M', boarding: 'BOARDER' })).id;
  [op, bm, bm2, plain, opB] = await Promise.all([actorOf(prisma, A.operator!.id), actorOf(prisma, bmU.id), actorOf(prisma, bm2U.id), actorOf(prisma, plainU.id), actorOf(prisma, B.operator!.id)]);
  // A hostel so the boarding masters reach the boarders.
  const hs = await import('@/lib/facilities/hostel');
  const hostel = (await hs.saveHostel(op, { name: 'Moyo House', gender: 'M', boardingMasterId: bm.id, capacity: 6 })).id;
  const room = (await hs.saveRoom(op, { hostelId: hostel, name: 'Room 1', capacity: 6 })).id;
  await hs.addBeds(op, { roomId: room, count: 4 });
  const beds = (await hs.getHostel(op, hostel)).rooms[0]!.beds.map((b) => b.id);
  await hs.allocateBed(op, { studentId: kid.amy!, bedId: beds[0]! });
  await hs.allocateBed(op, { studentId: kid.ben!, bedId: beds[1]! });
  // Stock in the Tuck shop store, priced.
  const store = (await inv.listStores(op)).stores.find((s) => s.name === 'Tuck shop')!.id;
  item.biscuits = (await inv.saveItem(op, { name: 'Biscuits', category: 'FOOD', priceCents: 50, priceCurrency: 'USD' })).id;
  item.juice = (await inv.saveItem(op, { name: 'Juice', category: 'FOOD', priceCents: 120, priceCurrency: 'USD' })).id;
  item.sweets = (await inv.saveItem(op, { name: 'Sweets ZiG', category: 'FOOD', priceCents: 5000, priceCurrency: 'ZIG' })).id;
  await inv.receiveStock(op, { storeId: store, reason: 'Opening stock', lines: [{ itemId: item.biscuits, qty: 30, unitCostCents: 30 }, { itemId: item.juice, qty: 30, unitCostCents: 80 }, { itemId: item.sweets, qty: 10, unitCostCents: 2000 }] });
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('pocket money in trust', () => {
  it('is paid into the pocket-money fund through Finance, for a boarder, and the wallet shows it', async () => {
    await fails(tuck.deposit(bm, { studentId: kid.day, currency: 'USD', amountCents: 1000 }), 409, /day scholar/);
    await fails(tuck.deposit(plain, { studentId: kid.amy, currency: 'USD', amountCents: 1000 }), 403);
    await fails(tuck.deposit(bm, { studentId: kid.amy, currency: 'USD', amountCents: 0 }), 422);
    await fails(tuck.deposit(bm, { studentId: kid.other, currency: 'USD', amountCents: 1000 }), 404);
    const r = await tuck.deposit(bm, { studentId: kid.amy, currency: 'USD', amountCents: 1000, paidBy: 'Mrs Amy' });
    expect(r.balanceCents).toBe(1000);
    expect(r.receipt).toBeTruthy();
    const entry = await prisma.facWalletEntry.findUniqueOrThrow({ where: { id: r.entryId } });
    const payment = await prisma.finPayment.findUniqueOrThrow({ where: { id: entry.paymentId! }, include: { fund: true } });
    expect(payment.fund?.code).toBe('POCKET');
    expect(payment.fund?.kind).toBe('TRUST');
    expect(payment.amountCents).toBe(1000);
  });

  it('is never used against a fee: no allocation of a pocket-money payment, and the database refuses it', async () => {
    const entry = await prisma.facWalletEntry.findFirstOrThrow({ where: { type: 'DEPOSIT' } });
    expect(await prisma.finPaymentAllocation.count({ where: { paymentId: entry.paymentId! } })).toBe(0);
    await expect(t.pg.query(`INSERT INTO "FinPaymentAllocation" ("id","schoolId","paymentId","chargeId","amountCents","createdById") VALUES ('al1','${A.schoolId}','${entry.paymentId}','nope',100,'${bm.id}')`)).rejects.toThrow(/held in trust|violates/);
  });

  it('holds one currency per wallet, is never overdrawn, and has a weekly limit', async () => {
    await fails(tuck.withdraw(bm, { studentId: kid.amy, currency: 'USD', amountCents: 5000, note: 'Too much' }), 409, /Not enough/);
    await fails(tuck.withdraw(bm, { studentId: kid.amy, currency: 'ZIG', amountCents: 100, note: 'No ZiG wallet' }), 404);
    await expect(t.pg.query(`INSERT INTO "FacWalletEntry" ("id","schoolId","walletId","currency","amountCents","type","note","createdById") SELECT 'w1','${A.schoolId}',"id",'ZIG',-100,'WITHDRAWAL','mixed','${bm.id}' FROM "FacWallet" LIMIT 1`)).rejects.toThrow(/never mixed/);
    await expect(t.pg.query(`INSERT INTO "FacWalletEntry" ("id","schoolId","walletId","currency","amountCents","type","note","createdById") SELECT 'w2','${A.schoolId}',"id",'USD',-999999,'WITHDRAWAL','over','${bm.id}' FROM "FacWallet" LIMIT 1`)).rejects.toThrow(/Not enough pocket money/);
    await tuck.setLimits(bm, { studentId: kid.amy, currency: 'USD', weeklyLimitCents: 300, lowBalanceCents: 200 });
  });
});

describe('the till', () => {
  it('sells for cash, takes stock out of the Tuck shop store, and counts a sale sent twice once', async () => {
    const before = (await tuck.tuckItems(bm)).find((i) => i.itemId === item.biscuits)!.qty;
    const sale = await tuck.sell(bm, { lines: [{ itemId: item.biscuits, qty: 4 }], payment: 'CASH', clientId: 'client-0001' });
    expect(sale.totalCents).toBe(200);
    sale1 = sale.saleId;
    const again = await tuck.sell(bm, { lines: [{ itemId: item.biscuits, qty: 4 }], payment: 'CASH', clientId: 'client-0001' });
    expect(again.duplicate).toBe(true);
    expect((await tuck.tuckItems(bm)).find((i) => i.itemId === item.biscuits)!.qty).toBe(before - 4);
    const row = await prisma.facTuckShopSale.findUniqueOrThrow({ where: { id: sale1 } });
    expect(row.costCents).toBe(120);
    await fails(tuck.sell(bm, { lines: [{ itemId: item.biscuits, qty: 400 }], payment: 'CASH' }), 409, /Not enough/);
    await fails(tuck.sell(bm, { lines: [{ itemId: item.biscuits, qty: 1 }, { itemId: item.sweets, qty: 1 }], payment: 'CASH' }), 422, /different currencies/);
    await fails(tuck.sell(plain, { lines: [{ itemId: item.biscuits, qty: 1 }], payment: 'CASH' }), 403);
  });

  it('pays from the wallet: balance down, weekly limit held, low balance told to the guardian, and never overdrawn', async () => {
    const r = await tuck.sell(bm, { lines: [{ itemId: item.juice, qty: 2 }], payment: 'WALLET', studentId: kid.amy });
    expect(r.balanceCents).toBe(760);
    expect(r.lowBalance).toBe(false);
    await fails(tuck.sell(bm, { lines: [{ itemId: item.juice, qty: 2 }], payment: 'WALLET', studentId: kid.amy }), 409, /weekly limit/);
    await fails(tuck.sell(bm, { lines: [{ itemId: item.biscuits, qty: 1 }], payment: 'WALLET', studentId: kid.ben }), 409, /no USD wallet/);
    await fails(tuck.sell(bm, { lines: [{ itemId: item.biscuits, qty: 1 }], payment: 'WALLET' }), 422);
    // Raise the limit, spend down to the low-balance line.
    await tuck.setLimits(bm, { studentId: kid.amy, currency: 'USD', weeklyLimitCents: 5000, lowBalanceCents: 200 });
    const low = await tuck.sell(bm, { lines: [{ itemId: item.juice, qty: 5 }], payment: 'WALLET', studentId: kid.amy });
    expect(low.balanceCents).toBe(160);
    expect(low.lowBalance).toBe(true);
    expect(await prisma.messageOutbox.count({ where: { schoolId: A.schoolId, studentId: kid.amy, body: { contains: 'pocket money is low' } } })).toBe(1);
    await fails(tuck.sell(bm, { lines: [{ itemId: item.juice, qty: 2 }], payment: 'WALLET', studentId: kid.amy }), 409, /Not enough pocket money/);
  });

  it('is held by the database too: a purchase must match a wallet sale', async () => {
    await expect(t.pg.query(`INSERT INTO "FacWalletEntry" ("id","schoolId","walletId","currency","amountCents","type","saleId","createdById") SELECT 'p1','${A.schoolId}',"id",'USD',-10,'PURCHASE','${sale1}','${bm.id}' FROM "FacWallet" LIMIT 1`)).rejects.toThrow(/must match a tuck shop sale/);
    await expect(t.pg.query(`INSERT INTO "FacTuckShopSale" ("id","schoolId","attendantId","payment","currency","totalCents","updatedAt") VALUES ('s9','${A.schoolId}','${bm.id}','WALLET','USD',100,now())`)).rejects.toThrow();
  });
});

describe('cash-up and the trust check', () => {
  it('compares counted cash with the cash sales, needs a note for a difference, and is confirmed by someone else', async () => {
    await fails(tuck.cashUp(bm, { currency: 'USD', countedCents: 100 }), 422, /Say why/);
    const r = await tuck.cashUp(bm, { currency: 'USD', countedCents: 150, note: 'Gave change from my pocket' });
    expect(r).toMatchObject({ expectedCents: 200, countedCents: 150, differenceCents: -50 });
    await fails(tuck.cashUp(bm, { currency: 'USD', countedCents: 200 }), 409, /already cashed up/);
    await fails(tuck.confirmCashUp(bm, r.id), 403);
    await fails(tuck.confirmCashUp(plain, r.id), 403);
    await tuck.confirmCashUp(op, r.id);
    await fails(tuck.confirmCashUp(op, r.id), 409);
    await expect(t.pg.query(`UPDATE "FacTuckShopCashUp" SET "confirmedById" = "attendantId" WHERE "id" = '${r.id}'`)).rejects.toThrow();
  });

  it('matches wallets to the fund, and flags money paid into the fund that is in no wallet', async () => {
    const ok = await tuck.trustCheck(bm);
    expect(ok.find((x) => x.currency === 'USD')).toMatchObject({ fundReceivedCents: 1000, financeDepositsCents: 1000, ok: true });
    const funds = await prisma.fund.findFirstOrThrow({ where: { schoolId: A.schoolId, code: 'POCKET' } });
    await payments.recordPayment(op, { studentId: kid.ben, currency: 'USD', method: 'CASH', paidBy: 'Parent', lines: [{ fundId: funds.id, amount: 5 }] });
    const bad = await tuck.trustCheck(bm);
    expect(bad.find((x) => x.currency === 'USD')).toMatchObject({ unmatchedCents: 500, ok: false });
  });

  it('hands money back and closes a wallet when a learner leaves', async () => {
    await tuck.deposit(bm, { studentId: kid.ben, currency: 'USD', amountCents: 700 });
    const out = await tuck.closeWallet(bm, { studentId: kid.ben, currency: 'USD', action: 'REFUNDED', note: 'Left the school' });
    expect(out.refundedCents).toBe(700);
    const w = await tuck.walletDetail(bm, kid.ben!, 'USD');
    expect(w).toMatchObject({ balanceCents: 0, closed: true });
    await fails(tuck.deposit(bm, { studentId: kid.ben, currency: 'USD', amountCents: 100 }), 409, /closed/);
    await fails(tuck.sell(bm, { lines: [{ itemId: item.biscuits, qty: 1 }], payment: 'WALLET', studentId: kid.ben }), 409, /closed/);
  });

  it('sends a weekly statement once', async () => {
    const scoped = await import('@/lib/scoped-db');
    const run = () => scoped.getScopedDb(A.schoolId, op.id).$tx((tx) => tuck.walletStatements(tx, A.schoolId));
    expect(await run()).toBeGreaterThanOrEqual(1);
    expect(await run()).toBe(0);
  });
});

describe('another school', () => {
  it('cannot see or touch these wallets', async () => {
    expect(await tuck.listWallets(opB)).toEqual([]);
    await fails(tuck.walletDetail(opB, kid.amy!, 'USD'), 404);
    await fails(tuck.deposit(opB, { studentId: kid.amy, currency: 'USD', amountCents: 100 }), 404);
    await fails(tuck.sell(opB, { lines: [{ itemId: item.biscuits, qty: 1 }], payment: 'CASH' }), 404);
    await fails(tuck.confirmCashUp(bm2, 'not-in-this-school'), 404);
  });
});

describe('the week', () => {
  it('starts on Monday in Harare', () => {
    expect(tuck.weekStart(new Date('2026-10-28T10:00:00+02:00')).toISOString()).toBe('2026-10-25T22:00:00.000Z');
    expect(tuck.weekStart(new Date('2026-10-25T23:30:00+02:00')).toISOString()).toBe('2026-10-18T22:00:00.000Z');
  });
});

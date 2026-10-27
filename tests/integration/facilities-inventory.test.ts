// @vitest-environment node
// Inventory and stores against a real PostgreSQL: stock is the sum of movements and never goes below zero, every receipt links to a
// purchase request or has a reason, a write-off needs the Head and cannot be approved by the person who asked, a sale to a learner
// becomes a Finance charge (or a ledger entry when Finance is off), counts above the school's limit wait for approval, and school A never
// sees or changes school B's stores.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, seedSchool, userWithRoles, type SeededSchool } from '../helpers/seed';
import { actorOf } from '../helpers/academics';
import { addStudent } from '../helpers/students';
import { call } from '../helpers/route';
import { fails } from '../helpers/finance';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

type Actor = Awaited<ReturnType<typeof actorOf>>;
let t: TestDb;
let prisma: typeof import('@/lib/prisma').prisma;
let inv: typeof import('@/lib/facilities/inventory');
let settings: typeof import('@/lib/facilities/settings');
let scoped: typeof import('@/lib/scoped-db');
let A: SeededSchool;
let B: SeededSchool;
let admin: Actor; let keeper: Actor; let head: Actor; let adminB: Actor;
let stores: Record<string, string> = {};
let bStores: Record<string, string> = {};
const item: Record<string, string> = {};
let learner: string;
let learnerB: string;

const onHand = async (S: SeededSchool, itemId: string, storeId: string) => Number((await prisma.facStockMovement.aggregate({ where: { schoolId: S.schoolId, itemId, storeId }, _sum: { qty: true } }))._sum.qty ?? 0);
const row = async (a: Actor, name: string, storeId?: string) => (await inv.stockTable(a, { storeId })).rows.find((r) => r.name === name)!;
const receive = (a: Actor, o: Record<string, unknown>) => inv.receiveStock(a, { storeId: stores['Main store'], reason: 'Opening stock at start of year', ...o });
const toStore = (name: string) => stores[name]!;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  [inv, settings, scoped] = await Promise.all([import('@/lib/facilities/inventory'), import('@/lib/facilities/settings'), import('@/lib/scoped-db')]);
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  await prisma.finSettings.create({ data: { schoolId: A.schoolId, legacyRetired: true } });
  await prisma.schoolModule.create({ data: { schoolId: B.schoolId, module: 'finance', enabled: false } });
  for (const k of ['view', 'receive', 'issue', 'count']) await grantPermission(prisma, A.schoolId, 'LIBRARIAN', `facilities.inventory.${k}`);
  await grantPermission(prisma, A.schoolId, 'HEAD', 'facilities.inventory.writeoff');
  await grantPermission(prisma, A.schoolId, 'HEAD', 'facilities.inventory.view');
  [admin, keeper, head, adminB] = await Promise.all([actorOf(prisma, A.operator!.id), actorOf(prisma, A.users.LIBRARIAN.id), actorOf(prisma, A.users.HEAD.id), actorOf(prisma, B.operator!.id)]);
  stores = Object.fromEntries((await inv.listStores(admin)).stores.map((s) => [s.name, s.id]));
  bStores = Object.fromEntries((await inv.listStores(adminB)).stores.map((s) => [s.name, s.id]));
  learner = (await addStudent(prisma, A, { firstName: 'Tino', surname: 'Ncube' })).id;
  learnerB = (await addStudent(prisma, B, { firstName: 'Bela', surname: 'Beta' })).id;
  const mk = async (name: string, o: Record<string, unknown>) => { item[name] = (await inv.saveItem(admin, { name, ...o })).id; };
  await mk('Maize meal', { category: 'FOOD', unit: 'KG', reorderLevel: 100 });
  await mk('Shirt', { category: 'UNIFORMS', size: 'M', gender: 'M', priceCents: 800, priceCurrency: 'USD', reorderLevel: 5, barcode: 'SHIRT-M' });
  await mk('Pens', { category: 'STATIONERY', priceCents: 50, priceCurrency: 'USD' });
  await mk('Paracetamol', { category: 'MEDICAL', tracksExpiry: true });
  await mk('Chalk', { category: 'STATIONERY', unit: 'BOX' });
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('set-up', () => {
  it('starts a school with the standard stores, each once', async () => {
    expect(Object.keys(stores).sort()).toEqual(['Agriculture', 'Kitchen', 'Main store', 'Sick bay', 'Stationery', 'Tuck shop', 'Uniform shop'].sort());
    expect((await inv.listStores(admin)).stores).toHaveLength(7);
  });

  it('needs the manage permission to add a store or an item, and rejects a duplicate barcode', async () => {
    await fails(inv.saveStore(keeper, { name: 'Shed' }), 403);
    await fails(inv.saveItem(keeper, { name: 'Pen', category: 'STATIONERY' }), 403);
    await fails(inv.saveItem(admin, { name: 'Other shirt', category: 'UNIFORMS', barcode: 'SHIRT-M' }), 409);
    await fails(inv.saveItem(admin, { name: 'Priced', category: 'UNIFORMS', priceCents: 100 }), 422);
    await fails(inv.saveStore(admin, { name: 'Kitchen' }), 409);
  });

  it('finds an item by the code on its label', async () => {
    expect(await inv.findItemByScan(keeper, 'SHIRT-M')).toMatchObject({ name: 'Shirt', size: 'M' });
    await fails(inv.findItemByScan(keeper, 'NOPE'), 404);
  });
});

describe('goods received', () => {
  it('without a purchase request needs a reason (a donation, opening stock)', async () => {
    await fails(inv.receiveStock(keeper, { storeId: toStore('Main store'), lines: [{ itemId: item['Maize meal'], qty: 100, unitCostCents: 120 }] }), 422, /reason/);
    await fails(receive(keeper, { reason: ' ', lines: [{ itemId: item['Maize meal'], qty: 100, unitCostCents: 120 }] }), 422);
    await receive(keeper, { lines: [{ itemId: item['Maize meal'], qty: 100, unitCostCents: 120 }] });
    expect(await onHand(A, item['Maize meal']!, toStore('Main store'))).toBe(100);
  });

  it('against a purchase request: only an approved one, with the delivery note, line by line, noting what is short', async () => {
    const fin = await import('@/lib/finance/requests');
    const funds = await scoped.getScopedDb(A.schoolId, admin.id).$tx(async (tx) => (await (await import('@/lib/finance/common')).ensureFunds(tx, A.schoolId)));
    const teacher = await actorOf(prisma, A.users.TEACHER.id);
    const owner = await actorOf(prisma, A.users.DIRECTOR.id);
    const mkReq = async (approve: boolean) => {
      const made = await fin.createRequest(teacher, { title: 'Uniforms', type: 'PURCHASE_ORDER', department: 'Stores', justification: 'Restock the shop', fundId: funds.find((f) => f.code === 'GENERAL')!.id, currency: 'USD', items: [{ description: 'Shirts M', quantity: 10, unit: 7 }], submit: true });
      if (approve) {
        await fin.decideRequest(admin, made.id, 'approve');
        if ((await prisma.finExpenseRequest.findUniqueOrThrow({ where: { id: made.id } })).status === 'PENDING') await fin.decideRequest(owner, made.id, 'approve');
      }
      return prisma.finExpenseRequest.findUniqueOrThrow({ where: { id: made.id }, include: { items: true } });
    };
    const pending = await mkReq(false);
    const approved = await mkReq(true);
    expect(approved.status).toBe('APPROVED');
    const line = approved.items[0]!.id;
    const base = { storeId: toStore('Uniform shop'), purchaseRequestId: approved.id, deliveryNote: 'DN-7731', lines: [{ itemId: item['Shirt'], qty: 6, unitCostCents: 700, requestItemId: line }] };

    await fails(inv.receiveStock(keeper, { ...base, purchaseRequestId: pending.id, lines: [{ ...base.lines[0], requestItemId: pending.items[0]!.id }] }), 409, /not approved/);
    await fails(inv.receiveStock(keeper, { ...base, deliveryNote: undefined }), 422, /delivery note/);
    await fails(inv.receiveStock(keeper, { ...base, lines: [{ itemId: item['Shirt'], qty: 6, unitCostCents: 700 }] }), 422, /line of the purchase request/);
    await fails(inv.receiveStock(keeper, { ...base, lines: [{ ...base.lines[0], qty: 11 }] }), 422, /still to be delivered/);
    await fails(inv.receiveStock(keeper, base), 422, /short or damaged/); // 6 of 10, no note

    const r = await inv.receiveStock(keeper, { ...base, lines: [{ ...base.lines[0], damagedQty: 1, shortfallNote: 'One carton wet; 3 shirts still to come' }] });
    expect(r.shortfalls).toHaveLength(1);
    const m = await prisma.facStockMovement.findFirstOrThrow({ where: { purchaseRequestId: approved.id } });
    expect(m).toMatchObject({ type: 'IN', qty: 6, unitCostCents: 700, deliveryNote: 'DN-7731', requestItemId: line, currency: 'USD' });
    expect((await inv.requestsToReceive(keeper)).find((x) => x.id === approved.id)!.lines[0]).toMatchObject({ ordered: 10, received: 6, outstanding: 4 });
    // The bursar is told about the short and damaged goods.
    expect(await prisma.notification.count({ where: { schoolId: A.schoolId, title: { contains: 'Short or damaged' } } })).toBeGreaterThan(0);
    // Finish the delivery: 4 more.
    await inv.receiveStock(keeper, { ...base, lines: [{ ...base.lines[0], qty: 4 }] });
    expect((await inv.requestsToReceive(keeper)).find((x) => x.id === approved.id)).toBeUndefined();
    expect(await onHand(A, item['Shirt']!, toStore('Uniform shop'))).toBe(10);
  });

  it('whole units for things counted one by one, an expiry date for things that expire', async () => {
    await fails(receive(keeper, { lines: [{ itemId: item['Chalk'], qty: 1.5, unitCostCents: 300 }] }), 422, /whole/);
    await fails(receive(keeper, { lines: [{ itemId: item['Paracetamol'], qty: 20, unitCostCents: 10 }] }), 422, /expiry/);
  });

  it('needs the receive permission', async () => {
    const teacher = await actorOf(prisma, A.users.TEACHER.id);
    await fails(receive(teacher, { lines: [{ itemId: item['Pens'], qty: 5, unitCostCents: 20 }] }), 403);
  });
});

describe('stock cost and stock on hand', () => {
  it('cost is the weighted average of what came in, and issues leave at the average', async () => {
    await receive(keeper, { lines: [{ itemId: item['Pens'], qty: 10, unitCostCents: 100 }] });
    await receive(keeper, { reason: 'Donation from the PTA', lines: [{ itemId: item['Pens'], qty: 10, unitCostCents: 200 }] });
    let r = await row(admin, 'Pens', toStore('Main store'));
    expect(r).toMatchObject({ qty: 20, avgCents: 150, valueCents: 3000, costCurrency: 'USD' });
    await inv.issueStock(keeper, { storeId: toStore('Main store'), itemId: item['Pens'], qty: 5, receiverName: 'Mrs Dube', department: 'Maths' });
    r = await row(admin, 'Pens', toStore('Main store'));
    expect(r).toMatchObject({ qty: 15, avgCents: 150, valueCents: 2250 });
  });

  it('a receipt in a different currency cannot be mixed into stock on hand', async () => {
    await fails(receive(keeper, { currency: 'ZIG', lines: [{ itemId: item['Pens'], qty: 1, unitCostCents: 5000 }] }), 409, /costed in USD/);
  });

  it('stock can never go below zero: too much is refused, and two people taking the last of it cannot both succeed', async () => {
    const pens = onHand(A, item['Pens']!, toStore('Main store'));
    await fails(inv.issueStock(keeper, { storeId: toStore('Main store'), itemId: item['Pens'], qty: 16, receiverName: 'Mr Greedy' }), 409, /Not enough/);
    expect(await pens).toBe(15);
    const take = (who: string) => inv.issueStock(keeper, { storeId: toStore('Main store'), itemId: item['Pens'], qty: 10, receiverName: who });
    const results = await Promise.allSettled([take('Mr One'), take('Mr Two')]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await onHand(A, item['Pens']!, toStore('Main store'))).toBe(5);
    await fails(inv.issueStock(keeper, { storeId: toStore('Kitchen'), itemId: item['Pens'], qty: 1, receiverName: 'Cook' }), 409); // nothing in the Kitchen
  });

  it('an issue names who received it', async () => {
    await fails(inv.issueStock(keeper, { storeId: toStore('Main store'), itemId: item['Maize meal'], qty: 5, receiverName: '' }), 422);
    await inv.issueStock(keeper, { storeId: toStore('Main store'), itemId: item['Maize meal'], qty: 5, receiverName: 'Cook Ruth', department: 'Kitchen' });
    const m = await prisma.facStockMovement.findFirstOrThrow({ where: { itemId: item['Maize meal'], type: 'ISSUE' } });
    expect(m).toMatchObject({ qty: -5, receiverName: 'Cook Ruth', department: 'Kitchen', unitCostCents: 120, createdById: keeper.id });
  });

  it('the batch that expires first goes first, and a batch keeps its date when moved', async () => {
    const p = item['Paracetamol']!;
    await inv.receiveStock(keeper, { storeId: toStore('Sick bay'), reason: 'Opening stock', lines: [{ itemId: p, qty: 10, unitCostCents: 20, expiry: '2027-06-01' }] });
    await inv.receiveStock(keeper, { storeId: toStore('Sick bay'), reason: 'Opening stock', lines: [{ itemId: p, qty: 10, unitCostCents: 20, expiry: '2026-11-01' }] });
    await inv.issueStock(keeper, { storeId: toStore('Sick bay'), itemId: p, qty: 12, receiverName: 'Matron' });
    const left = await prisma.facStockMovement.groupBy({ by: ['lotId'], where: { itemId: p, storeId: toStore('Sick bay') }, _sum: { qty: true } });
    const lots = await prisma.facStockLot.findMany({ where: { itemId: p } });
    const bal = Object.fromEntries(left.map((l) => [lots.find((x) => x.id === l.lotId)?.expiry?.toISOString().slice(0, 10), l._sum.qty]));
    expect(bal).toEqual({ '2026-11-01': 0, '2027-06-01': 8 });
    await inv.transferStock(keeper, { fromStoreId: toStore('Sick bay'), toStoreId: toStore('Main store'), itemId: p, qty: 3 });
    const moved = await prisma.facStockLot.findFirstOrThrow({ where: { itemId: p, storeId: toStore('Main store') } });
    expect(moved.expiry?.toISOString().slice(0, 10)).toBe('2027-06-01');
  });

  it('a transfer moves stock and its cost between two stores as one group', async () => {
    await inv.transferStock(keeper, { fromStoreId: toStore('Main store'), toStoreId: toStore('Stationery'), itemId: item['Pens'], qty: 2 });
    expect(await onHand(A, item['Pens']!, toStore('Stationery'))).toBe(2);
    expect(await onHand(A, item['Pens']!, toStore('Main store'))).toBe(3);
    const legs = await prisma.facStockMovement.findMany({ where: { type: 'TRANSFER', itemId: item['Pens'] } });
    expect(new Set(legs.map((l) => l.transferGroupId)).size).toBe(1);
    expect((await row(admin, 'Pens', toStore('Stationery'))).avgCents).toBe(150);
    await fails(inv.transferStock(keeper, { fromStoreId: toStore('Main store'), toStoreId: toStore('Main store'), itemId: item['Pens'], qty: 1 }), 422);
    await fails(inv.transferStock(keeper, { fromStoreId: toStore('Main store'), toStoreId: toStore('Stationery'), itemId: item['Pens'], qty: 99 }), 409);
  });
});

describe('selling to a learner', () => {
  it('charges the learner\'s account in Finance, and the stock goes out at once', async () => {
    const s = await inv.sellStock(keeper, { storeId: toStore('Uniform shop'), studentId: learner, lines: [{ itemId: item['Shirt'], qty: 2 }] });
    expect(s).toMatchObject({ totalCents: 1600, currency: 'USD', chargedTo: 'FINANCE', paid: false });
    const c = await prisma.finCharge.findUniqueOrThrow({ where: { id: s.chargeId! }, include: { fund: true } });
    expect(c).toMatchObject({ studentId: learner, amountCents: 1600, source: 'FACILITIES' });
    expect(c.description).toMatch(/Uniform: 2 × Shirt \(M\)/);
    expect(await onHand(A, item['Shirt']!, toStore('Uniform shop'))).toBe(8);
    const m = await prisma.facStockMovement.findFirstOrThrow({ where: { type: 'SALE' } });
    expect(m).toMatchObject({ studentId: learner, chargeId: s.chargeId, unitCostCents: 700, qty: -2 });
    expect(await prisma.facLedgerEntry.count({ where: { schoolId: A.schoolId } })).toBe(0);
  });

  it('paid on the spot goes through Finance as a cash payment against that charge', async () => {
    const s = await inv.sellStock(admin, { storeId: toStore('Uniform shop'), studentId: learner, lines: [{ itemId: item['Shirt'], qty: 1 }], payment: 'NOW' });
    expect(s).toMatchObject({ paid: true, paymentError: null });
    const p = await prisma.finPayment.findFirstOrThrow({ where: { schoolId: A.schoolId, studentId: learner, method: 'CASH' } });
    expect(p.amountCents).toBe(800);
    await fails(inv.sellStock(keeper, { storeId: toStore('Uniform shop'), studentId: learner, lines: [{ itemId: item['Shirt'], qty: 1 }], payment: 'NOW' }), 403, /record payments/);
  });

  it('refuses stock that is not there, an item with no price, and a learner of another school', async () => {
    await fails(inv.sellStock(keeper, { storeId: toStore('Uniform shop'), studentId: learner, lines: [{ itemId: item['Shirt'], qty: 50 }] }), 409);
    await fails(inv.sellStock(keeper, { storeId: toStore('Main store'), studentId: learner, lines: [{ itemId: item['Maize meal'], qty: 1 }] }), 422, /no selling price/);
    await fails(inv.sellStock(keeper, { storeId: toStore('Uniform shop'), studentId: learnerB, lines: [{ itemId: item['Shirt'], qty: 1 }] }), 404);
    expect(await onHand(A, item['Shirt']!, toStore('Uniform shop'))).toBe(7);
  });

  it('with Finance switched off, the amount sits on the inventory ledger, and paying now settles it', async () => {
    const shirtB = (await inv.saveItem(adminB, { name: 'Shirt', category: 'UNIFORMS', size: 'L', priceCents: 900, priceCurrency: 'USD' })).id;
    await inv.receiveStock(adminB, { storeId: bStores['Uniform shop'], reason: 'Opening stock', lines: [{ itemId: shirtB, qty: 5, unitCostCents: 600 }] });
    const onAccount = await inv.sellStock(adminB, { storeId: bStores['Uniform shop'], studentId: learnerB, lines: [{ itemId: shirtB, qty: 1 }] });
    expect(onAccount).toMatchObject({ chargedTo: 'LEDGER', chargeId: null });
    const e = await prisma.facLedgerEntry.findUniqueOrThrow({ where: { id: onAccount.ledgerEntryId! } });
    expect(e).toMatchObject({ part: 'INVENTORY', amountCents: 900, status: 'OPEN', studentId: learnerB });
    const paidNow = await inv.sellStock(adminB, { storeId: bStores['Uniform shop'], studentId: learnerB, lines: [{ itemId: shirtB, qty: 1 }], payment: 'NOW' });
    expect(paidNow.paid).toBe(true);
    expect((await prisma.facLedgerEntry.findUniqueOrThrow({ where: { id: paidNow.ledgerEntryId! } })).status).toBe('SETTLED');
    expect(await prisma.finCharge.count({ where: { schoolId: B.schoolId } })).toBe(0);
  });
});

describe('write-offs need the Head', () => {
  let id: string;

  it('nothing moves when a write-off is asked for', async () => {
    const before = await onHand(A, item['Maize meal']!, toStore('Main store'));
    id = (await inv.requestWriteoff(keeper, { storeId: toStore('Main store'), itemId: item['Maize meal'], qty: 10, writeoffReason: 'DAMAGED', reason: 'Rats got into the sacks' })).id;
    expect(await onHand(A, item['Maize meal']!, toStore('Main store'))).toBe(before);
    expect(await prisma.facStockMovement.count({ where: { type: 'WRITEOFF' } })).toBe(0);
    await fails(inv.requestWriteoff(keeper, { storeId: toStore('Main store'), itemId: item['Maize meal'], qty: 9999, writeoffReason: 'DAMAGED', reason: 'Too much' }), 409);
    await fails(inv.requestWriteoff(keeper, { storeId: toStore('Main store'), itemId: item['Maize meal'], qty: 1, writeoffReason: 'DAMAGED', reason: 'x' }), 422);
  });

  it('cannot be approved by someone without the write-off permission, or by the person who asked', async () => {
    await fails(inv.decideWriteoff(keeper, id, { decision: 'APPROVE' }), 403);
    // The Administrator asks, and then cannot approve their own request either.
    const own = await inv.requestWriteoff(admin, { storeId: toStore('Main store'), itemId: item['Maize meal'], qty: 1, writeoffReason: 'OTHER', reason: 'Spilled in the store' });
    await fails(inv.decideWriteoff(admin, own.id, { decision: 'APPROVE' }), 403, /own write-off/);
    await inv.decideWriteoff(head, own.id, { decision: 'REJECT', reason: 'Not a write-off, record it as an issue' });
    expect((await prisma.facWriteoffRequest.findUniqueOrThrow({ where: { id: own.id } })).status).toBe('REJECTED');
    await fails(inv.decideWriteoff(head, own.id, { decision: 'APPROVE' }), 409);
    await fails(inv.decideWriteoff(head, id, { decision: 'REJECT' }), 422, /why/);
  });

  it('is completed by the Head: the stock goes, at its cost, with the approver recorded', async () => {
    const before = await onHand(A, item['Maize meal']!, toStore('Main store'));
    expect(await inv.decideWriteoff(head, id, { decision: 'APPROVE' })).toEqual({ status: 'APPROVED' });
    expect(await onHand(A, item['Maize meal']!, toStore('Main store'))).toBe(before - 10);
    const m = await prisma.facStockMovement.findFirstOrThrow({ where: { type: 'WRITEOFF' } });
    expect(m).toMatchObject({ qty: -10, unitCostCents: 120, writeoffReason: 'DAMAGED', approvedById: head.id, reason: 'Rats got into the sacks', createdById: keeper.id });
    const req = await prisma.facWriteoffRequest.findUniqueOrThrow({ where: { id } });
    expect(req).toMatchObject({ status: 'APPROVED', decidedById: head.id, movementId: m.id });
    const log = await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: 'FAC_STOCK_WRITEOFF', entityId: id }, orderBy: { createdAt: 'asc' } });
    expect(log.map((l) => l.actorId)).toEqual([keeper.id, head.id]);
    expect(log[1]!.after).toMatchObject({ status: 'APPROVED', valueCents: 1200 });
  });
});

describe('stock counts', () => {
  let count: string;

  it('a sheet lists what the system thinks is in the store, and a differing count above the limit waits for the Head', async () => {
    count = (await inv.startCount(keeper, { storeId: toStore('Main store') })).id;
    await fails(inv.startCount(keeper, { storeId: toStore('Main store') }), 409);
    const sheet = await inv.getCount(keeper, count);
    const maize = sheet.lines.find((l) => l.name === 'Maize meal')!;
    expect(maize.expectedQty).toBe(85);
    await inv.saveCountLines(keeper, count, { lines: [{ itemId: item['Maize meal'], countedQty: 80 }, { itemId: item['Pens'], countedQty: 3 }] });
    expect((await inv.getCount(keeper, count)).lines.find((l) => l.name === 'Maize meal')).toMatchObject({ countedQty: 80, difference: -5, valueCents: 600 });
    const r = await inv.submitCount(keeper, count);
    expect(r).toMatchObject({ status: 'SUBMITTED', needsApproval: true, posted: 0 });
    expect(await onHand(A, item['Maize meal']!, toStore('Main store'))).toBe(85);
    await fails(inv.saveCountLines(keeper, count, { lines: [{ itemId: item['Maize meal'], countedQty: 1 }] }), 409);
  });

  it('is posted only when someone else with the write-off permission approves', async () => {
    await fails(inv.decideCount(keeper, count, { decision: 'APPROVE' }), 403);
    await fails(inv.decideCount(head, count, { decision: 'REJECT' }), 422);
    const r = await inv.decideCount(head, count, { decision: 'APPROVE' });
    expect(r).toEqual({ status: 'APPROVED', posted: 1 });
    expect(await onHand(A, item['Maize meal']!, toStore('Main store'))).toBe(80);
    const adj = await prisma.facStockMovement.findFirstOrThrow({ where: { type: 'ADJUSTMENT', countId: count } });
    expect(adj).toMatchObject({ qty: -5, approvedById: head.id, countId: count });
    expect(await prisma.facStockMovement.count({ where: { type: 'ADJUSTMENT', itemId: item['Pens'] } })).toBe(0); // counted what the system had
  });

  it('the person who submitted a count cannot approve it', async () => {
    const c2 = (await inv.startCount(admin, { storeId: toStore('Main store') })).id;
    await inv.saveCountLines(admin, c2, { lines: [{ itemId: item['Maize meal'], countedQty: 70 }] });
    expect((await inv.submitCount(admin, c2)).status).toBe('SUBMITTED');
    await fails(inv.decideCount(admin, c2, { decision: 'APPROVE' }), 403, /submitted/);
    await inv.decideCount(head, c2, { decision: 'REJECT', reason: 'Recount tomorrow' });
    expect(await onHand(A, item['Maize meal']!, toStore('Main store'))).toBe(80);
    expect((await prisma.facStockCount.findUniqueOrThrow({ where: { id: c2 } })).status).toBe('CLOSED');
  });

  it('differences worth no more than the school\'s limit are posted at once', async () => {
    await settings.updateFacSettings(admin, { adjustmentLimitUsdCents: 100000 });
    const c3 = (await inv.startCount(keeper, { storeId: toStore('Main store') })).id;
    await inv.saveCountLines(keeper, c3, { lines: [{ itemId: item['Maize meal'], countedQty: 79 }] });
    expect(await inv.submitCount(keeper, c3)).toMatchObject({ status: 'CLOSED', needsApproval: false, posted: 1 });
    expect(await onHand(A, item['Maize meal']!, toStore('Main store'))).toBe(79);
    const adj = await prisma.facStockMovement.findFirstOrThrow({ where: { countId: c3 } });
    expect(adj.approvedById).toBeNull();
    await fails(inv.submitCount(keeper, c3), 409);
  });
});

describe('alerts and reports', () => {
  it('lists items at or below their reorder level, and expiring batches', async () => {
    const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    await inv.receiveStock(keeper, { storeId: toStore('Sick bay'), reason: 'Donation', lines: [{ itemId: item['Paracetamol'], qty: 4, unitCostCents: 20, expiry: soon }] });
    const r = await inv.inventoryReports(admin);
    expect(r.lowStock.map((x) => x.item)).toEqual(expect.arrayContaining(['Maize meal']));
    expect(r.expiring).toEqual([expect.objectContaining({ item: 'Paracetamol', store: 'Sick bay', expiry: soon, qty: 4, expired: false })]);
    expect((await inv.stockTable(admin, { storeId: toStore('Sick bay') })).rows.find((x) => x.name === 'Paracetamol')!.expiringSoon).toBe(1);
  });

  it('values stock per store and per currency, never adding them together', async () => {
    const r = await inv.inventoryReports(admin);
    const main = r.stockValue.find((s) => s.store === 'Main store')!;
    expect(main.zigCents).toBe(0);
    expect(main.usdCents).toBeGreaterThan(0);
    expect(r.issuesByDepartment).toEqual(expect.arrayContaining([expect.objectContaining({ department: 'Kitchen', item: 'Maize meal', qty: 5 })]));
    expect(r.uniformSalesBySize).toEqual([expect.objectContaining({ item: 'Shirt', size: 'M', gender: 'M', qty: 3 })]);
    expect(r.countVariances.length).toBeGreaterThan(0);
  });

  it('raises a draft purchase request in Finance for the items below their reorder level', async () => {
    const low = (await inv.stockTable(admin, { lowOnly: true })).rows;
    expect(low.map((x) => x.name)).toContain('Maize meal');
    const r = await inv.reorderRequest(admin, { itemIds: [item['Maize meal']] });
    const req = await prisma.finExpenseRequest.findUniqueOrThrow({ where: { id: r.id }, include: { items: true } });
    expect(req).toMatchObject({ status: 'DRAFT', department: 'Stores' });
    expect(req.items[0]).toMatchObject({ description: 'Maize meal', quantity: 121, unitCents: 120 });
    await fails(inv.reorderRequest(admin, { itemIds: [item['Chalk']] }), 409);
  });
});

describe('one school never sees another', () => {
  it('stores, items and stock of A are invisible to B, and B cannot use them', async () => {
    const seen = (await inv.stockTable(adminB)).rows.map((r) => r.name);
    expect(seen).not.toContain('Maize meal');
    expect((await inv.listStores(adminB)).stores.map((s) => s.id)).not.toContain(stores['Main store']);
    await fails(inv.issueStock(adminB, { storeId: stores['Main store'], itemId: item['Maize meal'], qty: 1, receiverName: 'Thief' }), 404);
    await fails(inv.receiveStock(adminB, { storeId: bStores['Main store'], reason: 'Gift', lines: [{ itemId: item['Maize meal'], qty: 1, unitCostCents: 1 }] }), 404);
    await fails(inv.transferStock(adminB, { fromStoreId: bStores['Main store'], toStoreId: stores['Main store'], itemId: item['Pens'], qty: 1 }), 404);
    await fails(inv.getCount(adminB, (await prisma.facStockCount.findFirstOrThrow({ where: { schoolId: A.schoolId } })).id), 404);
    const w = await prisma.facWriteoffRequest.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    await fails(inv.decideWriteoff(adminB, w.id, { decision: 'REJECT', reason: 'Not yours' }), 404);
    await fails(inv.findItemByScan(adminB, 'SHIRT-M'), 404);
  });

  it('a purchase request of A cannot be received against by B', async () => {
    const pr = await prisma.finExpenseRequest.findFirstOrThrow({ where: { schoolId: A.schoolId, status: 'APPROVED' }, include: { items: true } });
    await fails(inv.receiveStock(adminB, { storeId: bStores['Main store'], purchaseRequestId: pr.id, deliveryNote: 'DN-1', lines: [{ itemId: item['Maize meal'], qty: 1, unitCostCents: 1, requestItemId: pr.items[0]!.id }] }), 404);
  });
});

describe('a part switched off', () => {
  it('refuses every inventory call for that school', async () => {
    await prisma.schoolModule.create({ data: { schoolId: B.schoolId, module: 'facilities.inventory', enabled: false } });
    const off = await actorOf(prisma, B.operator!.id);
    await fails(inv.stockTable(off), 403);
    await fails(inv.receiveStock(off, { storeId: bStores['Main store'], reason: 'Gift', lines: [{ itemId: item['Pens'], qty: 1, unitCostCents: 1 }] }), 403);
    await fails(inv.saveStore(off, { name: 'Hut' }), 403);
    expect((await call('facilities/inventory/items', 'GET', { as: B.operator! })).status).toBe(403);
  });
});

describe('the routes', () => {
  const routes: [string, 'GET' | 'POST', Record<string, string>?][] = [
    ['inventory/stores', 'GET'], ['inventory/stores', 'POST'], ['inventory/items', 'GET'], ['inventory/items', 'POST'], ['inventory/scan', 'GET'], ['inventory/requests', 'GET'],
    ['inventory/receive', 'POST'], ['inventory/issue', 'POST'], ['inventory/sell', 'POST'], ['inventory/transfer', 'POST'], ['inventory/writeoffs', 'GET'], ['inventory/writeoffs', 'POST'],
    ['inventory/writeoffs/[id]/decide', 'POST', { id: 'x' }], ['inventory/counts', 'GET'], ['inventory/counts', 'POST'], ['inventory/counts/[id]', 'GET', { id: 'x' }],
    ['inventory/counts/[id]/lines', 'POST', { id: 'x' }], ['inventory/counts/[id]/submit', 'POST', { id: 'x' }], ['inventory/counts/[id]/decide', 'POST', { id: 'x' }],
    ['inventory/reorder', 'POST'], ['inventory/reports', 'GET'], ['learners', 'GET'],
  ];
  for (const [file, method, params] of routes) {
    it(`${method} /api/facilities/${file}: 401 without a session, 403 for a teacher`, async () => {
      const body = method === 'GET' ? undefined : {};
      expect((await call(`facilities/${file}`, method, { as: null, params, body })).status).toBe(401);
      expect((await call(`facilities/${file}`, method, { as: await userWithRoles(prisma, A, ['TEACHER'], 'plain'), params, body })).status).toBe(403);
    });
  }

  it('work end to end for the storekeeper, with validation on the server', async () => {
    const storeId = toStore('Main store');
    const list = await call('facilities/inventory/items', 'GET', { as: A.users.LIBRARIAN, query: `?storeId=${storeId}` });
    expect(list.status).toBe(200);
    expect(list.json.data.rows.map((r: { name: string }) => r.name)).toContain('Maize meal');
    expect((await call('facilities/inventory/issue', 'POST', { as: A.users.LIBRARIAN, body: { storeId, itemId: item['Maize meal'], qty: -1, receiverName: 'X Y' } })).status).toBe(422);
    expect((await call('facilities/inventory/issue', 'POST', { as: A.users.LIBRARIAN, body: { storeId, itemId: item['Maize meal'], qty: 1, receiverName: 'Cook Ruth' } })).status).toBe(201);
    expect((await call('facilities/inventory/issue', 'POST', { as: A.users.LIBRARIAN, body: { storeId, itemId: item['Maize meal'], qty: 9999, receiverName: 'Cook Ruth' } })).status).toBe(409);
    expect((await call('facilities/inventory/issue', 'POST', { as: A.users.LIBRARIAN, rawBody: '{nope' })).status).toBe(400);
    // A storekeeper cannot approve the write-off they asked for.
    const w = await call('facilities/inventory/writeoffs', 'POST', { as: A.users.LIBRARIAN, body: { storeId, itemId: item['Maize meal'], qty: 1, writeoffReason: 'EXPIRED', reason: 'Past its date' } });
    expect(w.status).toBe(201);
    expect((await call('facilities/inventory/writeoffs/[id]/decide', 'POST', { as: A.users.LIBRARIAN, params: { id: w.json.data.id }, body: { decision: 'APPROVE' } })).status).toBe(403);
    expect((await call('facilities/inventory/writeoffs/[id]/decide', 'POST', { as: A.users.HEAD, params: { id: w.json.data.id }, body: { decision: 'APPROVE' } })).status).toBe(200);
  });

  it('school B\'s administrator cannot reach school A\'s count or write-off through the routes', async () => {
    const c = await prisma.facStockCount.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    const w = await prisma.facWriteoffRequest.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    await prisma.schoolModule.deleteMany({ where: { schoolId: B.schoolId, module: 'facilities.inventory' } });
    expect((await call('facilities/inventory/counts/[id]', 'GET', { as: B.operator!, params: { id: c.id } })).status).toBe(404);
    expect((await call('facilities/inventory/counts/[id]/submit', 'POST', { as: B.operator!, params: { id: c.id } })).status).toBe(404);
    expect((await call('facilities/inventory/writeoffs/[id]/decide', 'POST', { as: B.operator!, params: { id: w.id }, body: { decision: 'REJECT', reason: 'Nope nope' } })).status).toBe(404);
  });
});

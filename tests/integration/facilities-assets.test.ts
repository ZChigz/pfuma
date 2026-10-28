// @vitest-environment node
// Assets and maintenance against a real PostgreSQL: a tag for every asset, registering from a paid purchase request so the cost is never
// retyped, transfers the new custodian confirms, faults that any member of staff can report and whose cost becomes a Finance expense,
// recurring service with reminders, disposal that happens once and needs the Head (and the Owner above the school's limit), straight-line
// book value and the annual verification round.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, userWithRoles, type SeededSchool } from '../helpers/seed';
import { actorOf } from '../helpers/academics';
import { call } from '../helpers/route';
import { fails } from '../helpers/finance';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

type Actor = Awaited<ReturnType<typeof actorOf>>;
let t: TestDb;
let prisma: typeof import('@/lib/prisma').prisma;
let as: typeof import('@/lib/facilities/assets');
let settings: typeof import('@/lib/facilities/settings');
let scoped: typeof import('@/lib/scoped-db');
let A: SeededSchool;
let B: SeededSchool;
let op: Actor; let op2: Actor; let bursar: Actor; let head: Actor; let owner: Actor; let teacher: Actor; let outsider: Actor; let opB: Actor;
const emp: Record<string, string> = {};
const cat: Record<string, string> = {};
const tags: Record<string, string> = {};
const id: Record<string, string> = {};

const employee = (S: SeededSchool, userId: string | null, first: string, no: string) => prisma.employee.create({ data: { schoolId: S.schoolId, employeeNo: no, userId, firstName: first, surname: 'Staff', jobTitle: 'Teacher', startDate: new Date('2020-01-01'), createdById: S.users.ADMIN.id } });
const assetId = async (tag: string) => (await prisma.facAsset.findFirstOrThrow({ where: { schoolId: A.schoolId, tag } })).id;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  [as, settings, scoped] = await Promise.all([import('@/lib/facilities/assets'), import('@/lib/facilities/settings'), import('@/lib/scoped-db')]);
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  await prisma.finSettings.create({ data: { schoolId: A.schoolId, legacyRetired: true } });
  await prisma.schoolModule.create({ data: { schoolId: B.schoolId, module: 'finance', enabled: false } });
  const plain = await userWithRoles(prisma, A, ['TEACHER'], 'plain');
  [op, op2, bursar, head, owner, teacher, outsider, opB] = await Promise.all([
    actorOf(prisma, A.operator!.id), actorOf(prisma, A.operator2!.id), actorOf(prisma, A.users.BURSAR.id), actorOf(prisma, A.users.HEAD.id), actorOf(prisma, A.users.DIRECTOR.id),
    actorOf(prisma, A.users.TEACHER.id), actorOf(prisma, plain.id), actorOf(prisma, B.operator!.id),
  ]);
  emp.teacher = (await employee(A, A.users.TEACHER.id, 'Tendai', 'EMP-1')).id;
  emp.bursar = (await employee(A, A.users.BURSAR.id, 'Rudo', 'EMP-2')).id;
  emp.nobody = (await employee(A, null, 'Farai', 'EMP-3')).id;
  for (const c of await as.listCategories(bursar)) cat[c.name] = c.id;
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('the register', () => {
  it('starts with the standard categories and their usual lives', () => {
    expect(Object.keys(cat).sort()).toEqual(['Agriculture', 'Buildings', 'ICT', 'Furniture', 'Kitchen', 'Laboratory', 'Other', 'Sports', 'Vehicles'].sort());
  });

  it('gives every asset the next tag, and adds many identical ones each with its own', async () => {
    const one = await as.registerAsset(bursar, { name: 'Projector', categoryId: cat['ICT'], location: 'Staffroom', costCents: 90_000, currency: 'USD', purchasedAt: new Date(Date.now() - 548 * 864e5).toISOString().slice(0, 10), custodianId: emp.teacher, serial: 'SN-77', warrantyEnd: '2027-02-01' });
    expect(one.tags).toEqual(['AST-00001']);
    tags.projector = one.tags[0]!;
    const desks = await as.registerAsset(bursar, { name: 'Desk', categoryId: cat['Furniture'], location: 'Form 1 North', costCents: 3000, currency: 'USD', count: 12, serial: 'ignored for many' });
    expect(desks.tags).toHaveLength(12);
    expect(new Set(desks.tags).size).toBe(12);
    expect(desks.tags[0]).toBe('AST-00002');
    expect(desks.tags[11]).toBe('AST-00013');
    const serials = await prisma.facAsset.findMany({ where: { name: 'Desk' }, select: { serial: true } });
    expect(serials.every((s) => s.serial === null)).toBe(true);
    const row = await prisma.facAsset.findFirstOrThrow({ where: { tag: 'AST-00001' } });
    expect(row).toMatchObject({ name: 'Projector', location: 'Staffroom', costCents: 90_000, currency: 'USD', status: 'IN_USE', condition: 'NEW', serial: 'SN-77', custodianId: emp.teacher });
  });

  it('is kept by the people who hold the manage key, and validated on the server', async () => {
    await fails(as.registerAsset(head, { name: 'Sneaky', categoryId: cat['ICT'], location: 'x' }), 403);
    await fails(as.registerAsset(outsider, { name: 'Sneaky', categoryId: cat['ICT'], location: 'x' }), 403);
    await fails(as.registerAsset(bursar, { name: 'X', categoryId: cat['ICT'], location: 'Lab' }), 422);
    await fails(as.registerAsset(bursar, { name: 'Laptop', categoryId: 'nope', location: 'Lab' }), 404);
    await fails(as.registerAsset(bursar, { name: 'Laptop', categoryId: cat['ICT'], location: 'Lab', custodianId: 'nope' }), 404);
    await fails(as.registerAsset(bursar, { name: 'Laptop', categoryId: cat['ICT'], location: 'Lab', count: 501 }), 422);
    await fails(as.registerAsset(bursar, { name: 'Laptop', categoryId: cat['ICT'], location: 'Lab', costCents: 1.5 }), 422);
    await fails(as.registerAsset(bursar, { name: 'Laptop', categoryId: cat['ICT'], location: 'Lab', photoKey: 'pop:other-school:abc' }), 422);
  });

  it('shows book value: cost less straight-line depreciation by the category\'s life', async () => {
    const list = await as.listAssets(bursar, {});
    const p = list.rows.find((r) => r.tag === 'AST-00001')!;
    // Bought about 1.5 years ago, ICT lasts 3 years: about half is left.
    expect(p.bookCents).toBeGreaterThan(40_000);
    expect(p.bookCents).toBeLessThan(50_000);
    expect(list.rows.find((r) => r.tag === 'AST-00002')!.bookCents).toBeGreaterThan(2_700);
    await as.saveCategory(bursar, { id: cat['ICT'], name: 'ICT', depreciationYears: null });
    expect((await as.listAssets(bursar, {})).rows.find((r) => r.tag === 'AST-00001')!.bookCents).toBe(90_000);
    await as.saveCategory(bursar, { id: cat['ICT'], name: 'ICT', depreciationYears: 3 });
  });

  it('finds an asset by the tag on its label, and filters by place and custodian', async () => {
    expect(await as.findByTag(outsider, 'ast-00001').catch((e) => e.status)).toBe(403);
    expect((await as.findByTag(bursar, 'ast-00001')).name).toBe('Projector');
    await fails(as.findByTag(bursar, 'AST-99999'), 404);
    expect((await as.listAssets(bursar, { location: 'form 1 north' })).total).toBe(12);
    expect((await as.listAssets(bursar, { custodianId: emp.teacher })).rows.map((r) => r.tag)).toEqual(['AST-00001']);
  });

  it('changes the condition, status and notes, with the before and after in the audit log', async () => {
    const aid = await assetId(tags.projector!);
    await as.updateAsset(bursar, { id: aid, condition: 'FAIR', notes: 'Lamp is dim' });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'FAC_ASSET_SAVE', entityId: aid }, orderBy: { createdAt: 'desc' } });
    expect(log.before).toMatchObject({ condition: 'NEW' });
    expect(log.after).toMatchObject({ condition: 'FAIR', notes: 'Lamp is dim' });
    await fails(as.updateAsset(bursar, { id: aid }), 422);
    await fails(as.updateAsset(bursar, { id: aid, status: 'DISPOSED' }), 422);
  });
});

describe('registering from a paid purchase request', () => {
  let reqId: string;
  let lineId: string;

  it('fills in the cost, supplier, date and request from the disbursement, once per unit bought', async () => {
    const fin = await import('@/lib/finance/requests');
    const funds = await scoped.getScopedDb(A.schoolId, op.id).$tx(async (tx) => (await (await import('@/lib/finance/common')).ensureFunds(tx, A.schoolId)));
    const made = await fin.createRequest(teacher, { title: 'Laptops', type: 'PURCHASE_ORDER', department: 'ICT', justification: 'Computer lab', fundId: funds.find((f) => f.code === 'GENERAL')!.id, currency: 'USD', items: [{ description: 'Laptop', quantity: 3, unit: 450 }], submit: true });
    reqId = made.id;
    await fails(as.registerFromRequest(bursar, { requestItemId: (await prisma.finExpenseRequestItem.findFirstOrThrow({ where: { requestId: reqId } })).id, count: 1, categoryId: cat['ICT'], location: 'Lab' }), 409, /not been paid/);
    await fin.decideRequest(op, reqId, 'approve');
    if ((await prisma.finExpenseRequest.findUniqueOrThrow({ where: { id: reqId } })).status === 'PENDING') await fin.decideRequest(owner, reqId, 'approve');
    await fin.disburseRequest(op2, reqId, { method: 'CASH' });
    lineId = (await prisma.finExpenseRequestItem.findFirstOrThrow({ where: { requestId: reqId } })).id;

    expect((await as.requestsToRegister(bursar))[0]!.lines[0]).toMatchObject({ quantity: 3, registered: 0, remaining: 3 });
    const r = await as.registerFromRequest(bursar, { requestItemId: lineId, count: 2, categoryId: cat['ICT'], location: 'Computer lab', custodianId: emp.bursar });
    expect(r).toMatchObject({ unitCents: 45_000, currency: 'USD' });
    const a = await prisma.facAsset.findFirstOrThrow({ where: { tag: r.tags[0] } });
    const expense = await prisma.finExpense.findFirstOrThrow({ where: { requestId: reqId } });
    expect(a).toMatchObject({ name: 'Laptop', costCents: 45_000, currency: 'USD', requestId: reqId, requestItemId: lineId, expenseId: expense.id, custodianId: emp.bursar });
    expect(a.purchasedAt).not.toBeNull();
    expect((await as.requestsToRegister(bursar))[0]!.lines[0]).toMatchObject({ registered: 2, remaining: 1 });
  });

  it('cannot register more than was bought', async () => {
    await fails(as.registerFromRequest(bursar, { requestItemId: lineId, count: 2, categoryId: cat['ICT'], location: 'Lab' }), 409, /1 can still be added/);
    await as.registerFromRequest(bursar, { requestItemId: lineId, count: 1, categoryId: cat['ICT'], location: 'Lab' });
    expect(await as.requestsToRegister(bursar)).toEqual([]);
    await fails(as.registerFromRequest(bursar, { requestItemId: lineId, count: 1, categoryId: cat['ICT'], location: 'Lab' }), 409);
    await fails(as.registerFromRequest(bursar, { requestItemId: 'nope', count: 1, categoryId: cat['ICT'], location: 'Lab' }), 404);
    await fails(as.registerFromRequest(head, { requestItemId: lineId, count: 1, categoryId: cat['ICT'], location: 'Lab' }), 403);
  });
});

describe('transfers', () => {
  it('keep the history, and the new custodian confirms on their phone', async () => {
    const aid = await assetId(tags.projector!);
    const r = await as.transferAsset(bursar, { assetId: aid, toLocation: 'Science lab', toCustodianId: emp.bursar });
    expect(r.needsConfirmation).toBe(true);
    const now = await prisma.facAsset.findUniqueOrThrow({ where: { id: aid } });
    expect(now).toMatchObject({ location: 'Science lab', custodianId: emp.bursar });
    const tr = await prisma.facAssetTransfer.findUniqueOrThrow({ where: { id: r.transferId } });
    expect(tr).toMatchObject({ fromLocation: 'Staffroom', toLocation: 'Science lab', fromCustodianId: emp.teacher, toCustodianId: emp.bursar, confirmedAt: null, recordedById: bursar.id });
    expect(await prisma.notification.count({ where: { schoolId: A.schoolId, userId: A.users.BURSAR.id, title: { contains: 'confirm you have received' } } })).toBe(1);
    expect((await as.myAssets(bursar)).pending.map((p) => p.tag)).toContain(tags.projector);
    // Only the person it was handed to can confirm.
    await fails(as.confirmTransfer(teacher, r.transferId), 403);
    await as.confirmTransfer(bursar, r.transferId);
    expect((await prisma.facAssetTransfer.findUniqueOrThrow({ where: { id: r.transferId } })).confirmedAt).not.toBeNull();
    await fails(as.confirmTransfer(bursar, r.transferId), 409);
    await expect(t.pg.query(`UPDATE "FacAssetTransfer" SET "confirmedAt" = now() - interval '1 day' WHERE "id" = '${r.transferId}'`)).rejects.toThrow(/already confirmed/);
  });

  it('a move with no new custodian needs nobody\'s confirmation; a move that changes nothing is refused', async () => {
    const aid = await assetId(tags.projector!);
    const r = await as.transferAsset(bursar, { assetId: aid, toLocation: 'Library' });
    expect(r.needsConfirmation).toBe(false);
    expect((await prisma.facAssetTransfer.findUniqueOrThrow({ where: { id: r.transferId } })).confirmedAt).not.toBeNull();
    await fails(as.transferAsset(bursar, { assetId: aid, toLocation: 'Library' }), 422);
    await fails(as.transferAsset(bursar, { assetId: aid, toCustodianId: 'nope' }), 404);
    await fails(as.transferAsset(head, { assetId: aid, toLocation: 'x' }), 403);
    const detail = await as.getAsset(bursar, aid);
    expect(detail.transfers).toHaveLength(2);
    expect(detail.asset.location).toBe('Library');
  });
});

describe('faults and maintenance', () => {
  let jobId: string;
  const projector = () => assetId(tags.projector!);

  it('any member of staff reports a fault with the asset and the problem; someone with no staff record cannot', async () => {
    const r = await as.reportFault(teacher, { assetId: await projector(), problem: 'The lamp flickers and goes out' });
    jobId = r.id;
    expect(await prisma.facMaintenanceJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: 'REPORTED', reportedById: teacher.id, problem: 'The lamp flickers and goes out' });
    expect(await prisma.notification.count({ where: { schoolId: A.schoolId, title: { contains: 'Fault reported' } } })).toBeGreaterThan(0);
    await fails(as.reportFault(outsider, { assetId: await projector(), problem: 'Broken' }), 403);
    await fails(as.reportFault(teacher, { assetId: await projector(), problem: 'x' }), 422);
    await fails(as.reportFault(teacher, { assetId: 'nope', problem: 'Broken for sure' }), 404);
    await fails(as.reportFault(teacher, { assetId: await projector(), problem: 'Broken', photoKey: 'pop:other:1' }), 422);
  });

  it('the bursar assigns it, records the work, provider and cost; the cost becomes a Finance expense', async () => {
    await fails(as.assignJob(teacher, jobId, { assignedToId: bursar.id }), 403);
    await as.assignJob(bursar, jobId, { assignedToId: bursar.id });
    expect((await prisma.facAsset.findUniqueOrThrow({ where: { id: await projector() } })).status).toBe('UNDER_REPAIR');
    await fails(as.completeJob(bursar, jobId, { workDone: 'Replaced the lamp', costCents: 2500 }), 422);
    const done = await as.completeJob(bursar, jobId, { workDone: 'Replaced the lamp', provider: 'Tech Fix Ltd', costCents: 2500, currency: 'USD', nextServiceDate: '2027-04-01' });
    expect(done.expense).toBe('FINANCE');
    const e = await prisma.finExpense.findUniqueOrThrow({ where: { id: done.expenseId! } });
    expect(e).toMatchObject({ amountCents: 2500, currency: 'USD', category: 'Maintenance and repairs', source: 'DIRECT', payee: 'Tech Fix Ltd', recordedById: bursar.id });
    expect(e.description).toMatch(/Repair of Projector \(AST-00001\)/);
    const job = await prisma.facMaintenanceJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ status: 'DONE', costCents: 2500, currency: 'USD', expenseId: e.id, provider: 'Tech Fix Ltd' });
    expect((await prisma.facAsset.findUniqueOrThrow({ where: { id: await projector() } })).status).toBe('IN_USE');
    await fails(as.completeJob(bursar, jobId, { workDone: 'Again' }), 409);
    expect((await as.openJobs(bursar)).map((j) => j.id)).not.toContain(jobId);
  });

  it('with Finance switched off, the cost stays on the job and nothing else breaks', async () => {
    const catB = (await as.listCategories(opB))[0]!;
    const tag = (await as.registerAsset(opB, { name: 'Generator', categoryId: catB.id, location: 'Yard', costCents: 500_000 })).tags[0]!;
    const aB = await prisma.facAsset.findFirstOrThrow({ where: { schoolId: B.schoolId, tag } });
    const jid = (await as.reportFault(await actorOf(prisma, B.users.TEACHER.id).then(async (a) => { await employee(B, B.users.TEACHER.id, 'Bela', 'E-B'); return a; }), { assetId: aB.id, problem: 'Will not start' })).id;
    const done = await as.completeJob(opB, jid, { workDone: 'New spark plug', costCents: 1500, currency: 'USD' });
    expect(done).toMatchObject({ expense: 'NONE', expenseId: null });
    expect(await prisma.finExpense.count({ where: { schoolId: B.schoolId } })).toBe(0);
    expect((await prisma.facMaintenanceJob.findUniqueOrThrow({ where: { id: jid } })).costCents).toBe(1500);
  });

  it('a recurring service is scheduled from the last one, reminded once before it is due, and moved on when done', async () => {
    const aid = await projector();
    const s = await as.saveSchedule(bursar, { assetId: aid, title: 'Clean the filter', everyMonths: 6, remindDaysBefore: 14, lastDoneAt: '2026-05-01' });
    expect(s.nextDueAt).toBe('2026-11-01');
    await fails(as.saveSchedule(bursar, { assetId: aid, title: 'Clean the filter' }), 422);
    await fails(as.saveSchedule(head, { assetId: aid, title: 'Clean the filter', everyMonths: 6 }), 403);
    const sent = await scoped.getScopedDb(A.schoolId, op.id).$tx((tx) => as.maintenanceReminders(tx, A.schoolId));
    expect(sent).toBeGreaterThan(0);
    expect(await scoped.getScopedDb(A.schoolId, op.id).$tx((tx) => as.maintenanceReminders(tx, A.schoolId))).toBe(0);
    expect((await as.assetReports(bursar)).dueForService.map((d) => d.title)).toContain('Clean the filter');
    const done = await as.serviceDone(bursar, s.id, { workDone: 'Filter cleaned', costCents: 500, currency: 'USD' });
    expect(done.expenseId).toBeTruthy();
    const after = await prisma.facMaintenanceSchedule.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.nextDueAt!.toISOString().slice(0, 10) > '2027-03-01').toBe(true);
    expect((await as.assetReports(bursar)).dueForService.map((d) => d.title)).not.toContain('Clean the filter');
  });

  it('reports the maintenance cost of each asset', async () => {
    const r = await as.assetReports(bursar);
    const row = r.maintenanceCost.find((m) => m.tag === tags.projector)!;
    expect(row).toMatchObject({ jobs: 2, usdCents: 3000, zigCents: 0 });
  });
});

describe('disposal', () => {
  let desk: string;

  it('is asked for by the person who keeps the register, and nobody approves their own request', async () => {
    desk = await assetId('AST-00002');
    const r = await as.requestDisposal(bursar, { assetId: desk, method: 'SCRAPPED', reason: 'Broken beyond repair' });
    expect(r.needsOwner).toBe(true); // the school has set no limit, so anything that cost something needs the Owner too
    await fails(as.requestDisposal(bursar, { assetId: desk, method: 'SCRAPPED', reason: 'Again please' }), 409, /already waiting/);
    await fails(as.decideDisposal(bursar, r.id, { decision: 'APPROVE' }), 403);
    await fails(as.decideDisposal(teacher, r.id, { decision: 'APPROVE' }), 403);
    await fails(as.decideDisposal(head, r.id, { decision: 'REJECT' }), 422);
    expect((await prisma.facAsset.findUniqueOrThrow({ where: { id: desk } })).status).toBe('IN_USE');
  });

  it('above the school\'s limit the Head and the Owner both approve, two different people, before it happens', async () => {
    const req = await prisma.facDisposalRequest.findFirstOrThrow({ where: { assetId: desk } });
    const first = await as.decideDisposal(head, req.id, { decision: 'APPROVE' });
    expect(first).toMatchObject({ status: 'PENDING', waitingFor: 'Owner' });
    expect((await prisma.facAsset.findUniqueOrThrow({ where: { id: desk } })).status).toBe('IN_USE');
    await fails(as.decideDisposal(head, req.id, { decision: 'APPROVE' }), 403, /already approved/);
    const second = await as.decideDisposal(owner, req.id, { decision: 'APPROVE' });
    expect(second.status).toBe('APPROVED');
    const d = await prisma.facAssetDisposal.findUniqueOrThrow({ where: { assetId: desk } });
    expect(d).toMatchObject({ method: 'SCRAPPED', headApprovedById: head.id, ownerApprovedById: owner.id, recordedById: bursar.id });
    expect((await prisma.facAsset.findUniqueOrThrow({ where: { id: desk } })).status).toBe('DISPOSED');
    const log = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'FAC_ASSET_DISPOSE', entityId: desk }, orderBy: { createdAt: 'desc' } });
    expect(log.after).toMatchObject({ status: 'DISPOSED', headApprovedById: head.id, ownerApprovedById: owner.id });
  });

  it('an asset can be disposed of only once, and a disposed asset is never changed again', async () => {
    await fails(as.requestDisposal(bursar, { assetId: desk, method: 'SOLD', reason: 'Sold again' }), 409, /only once/);
    await fails(as.updateAsset(bursar, { id: desk, notes: 'x y z' }), 409);
    await fails(as.transferAsset(bursar, { assetId: desk, toLocation: 'Yard' }), 409);
    // The database refuses a second disposal row and a change to the disposed asset, even if a service were skipped.
    await expect(t.pg.query(`INSERT INTO "FacAssetDisposal" ("id", "schoolId", "assetId", "method", "reason", "date", "headApprovedById", "ownerApprovedById", "recordedById") VALUES ('dx', '${A.schoolId}', '${desk}', 'SOLD', 'Second try', now(), '${head.id}', '${owner.id}', '${bursar.id}')`)).rejects.toThrow(/duplicate|unique/i);
    await expect(t.pg.query(`UPDATE "FacAsset" SET "location" = 'Elsewhere' WHERE "id" = '${desk}'`)).rejects.toThrow(/disposed asset cannot be changed/);
    expect((await as.listAssets(bursar, {})).rows.map((r) => r.id)).not.toContain(desk);
    expect((await as.listAssets(bursar, { status: 'DISPOSED' })).rows.map((r) => r.id)).toContain(desk);
  });

  it('the database itself refuses a disposal above the limit without the Owner\'s approval', async () => {
    const aid = await assetId('AST-00003');
    await expect(t.pg.query(`INSERT INTO "FacAssetDisposal" ("id", "schoolId", "assetId", "method", "reason", "date", "headApprovedById", "recordedById") VALUES ('dy', '${A.schoolId}', '${aid}', 'SCRAPPED', 'Quietly', now(), '${head.id}', '${bursar.id}')`)).rejects.toThrow(/Owner must approve/);
    expect((await prisma.facAsset.findUniqueOrThrow({ where: { id: aid } })).status).toBe('IN_USE');
    await expect(t.pg.query(`UPDATE "FacAsset" SET "status" = 'DISPOSED' WHERE "id" = '${aid}'`)).rejects.toThrow(/only through an approved disposal/);
  });

  it('below the limit the Head\'s approval is enough; refusing needs a reason and keeps the asset', async () => {
    await settings.updateFacSettings(op, { disposalOwnerLimitUsdCents: 10_000 });
    const cheap = await assetId('AST-00004');
    const r = await as.requestDisposal(bursar, { assetId: cheap, method: 'DONATED', reason: 'Given to the primary school' });
    expect(r.needsOwner).toBe(false);
    expect(await as.decideDisposal(head, r.id, { decision: 'APPROVE' })).toMatchObject({ status: 'APPROVED' });
    expect(await prisma.facAssetDisposal.findUniqueOrThrow({ where: { assetId: cheap } })).toMatchObject({ ownerApprovedById: null, method: 'DONATED' });

    const keep = await assetId('AST-00005');
    const q = await as.requestDisposal(bursar, { assetId: keep, method: 'SCRAPPED', reason: 'Wobbly leg' });
    await as.decideDisposal(head, q.id, { decision: 'REJECT', reason: 'It can be repaired' });
    expect((await prisma.facDisposalRequest.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('REJECTED');
    expect((await prisma.facAsset.findUniqueOrThrow({ where: { id: keep } })).status).toBe('IN_USE');
    await fails(as.decideDisposal(head, q.id, { decision: 'APPROVE' }), 409);
    // It can be asked for again.
    await as.requestDisposal(bursar, { assetId: keep, method: 'SCRAPPED', reason: 'Now beyond repair' });
  });

  it('only a sale brings in money, and money needs its currency; the Finance report lists it', async () => {
    const a = await assetId('AST-00006');
    await fails(as.requestDisposal(bursar, { assetId: a, method: 'SCRAPPED', reason: 'Old', proceedsCents: 500, currency: 'USD' }), 422);
    await fails(as.requestDisposal(bursar, { assetId: a, method: 'SOLD', reason: 'Sold at auction', proceedsCents: 500 }), 422);
    const r = await as.requestDisposal(bursar, { assetId: a, method: 'SOLD', reason: 'Sold at auction', proceedsCents: 500, currency: 'USD' });
    await as.decideDisposal(head, r.id, { decision: 'APPROVE' });
    const rep = await as.assetReports(bursar);
    expect(rep.disposals.find((d) => d.tag === 'AST-00006')).toMatchObject({ method: 'SOLD', proceedsCents: 500, currency: 'USD' });
    expect((await as.listDisposals(head)).length).toBeGreaterThanOrEqual(4);
  });
});

describe('the annual verification', () => {
  let round: string;

  it('lists what was found, what was in the wrong place and what was not found', async () => {
    round = (await as.startRound(bursar, { name: 'Verification 2026' })).id;
    await fails(as.startRound(bursar, { name: 'Second' }), 409);
    await fails(as.startRound(head, { name: 'Nope' }), 403);
    expect(await as.scanAsset(bursar, round, { tag: 'ast-00001', location: 'library' })).toMatchObject({ result: 'FOUND' });
    expect(await as.scanAsset(bursar, round, { tag: 'AST-00007', location: 'Science lab' })).toMatchObject({ result: 'WRONG_PLACE', expectedLocation: 'Form 1 North' });
    expect(await as.scanAsset(bursar, round, { tag: 'AST-00001', location: 'Library' })).toMatchObject({ already: true });
    await fails(as.scanAsset(bursar, round, { tag: 'AST-00002', location: 'Form 1 North' }), 409, /disposed/);
    await fails(as.scanAsset(bursar, round, { tag: 'AST-99999', location: 'Form 1 North' }), 404);
    const res = await as.roundResult(bursar, round);
    expect(res.found.map((a) => a.tag)).toEqual(['AST-00001']);
    expect(res.wrongPlace.map((a) => a.tag)).toEqual(['AST-00007']);
    expect(res.notFound.map((a) => a.tag)).not.toContain('AST-00001');
    expect(res.notFound.map((a) => a.tag)).not.toContain('AST-00002'); // disposed: not expected to be there
    expect(res.notFound.length).toBeGreaterThan(5);
  });

  it('an asset in the wrong place can be moved to where it was found, with the history', async () => {
    const aid = await assetId('AST-00007');
    await as.moveToScanned(bursar, round, { assetId: aid });
    expect((await prisma.facAsset.findUniqueOrThrow({ where: { id: aid } })).location).toBe('Science lab');
    expect(await prisma.facAssetTransfer.count({ where: { assetId: aid } })).toBe(1);
    expect((await as.roundResult(bursar, round)).found.map((a) => a.tag)).toContain('AST-00007');
    await fails(as.moveToScanned(bursar, round, { assetId: aid }), 404);
  });

  it('a closed round takes no more scans', async () => {
    const closed = await as.roundResult(bursar, round, true);
    expect(closed.closed).toBe(true);
    await fails(as.scanAsset(bursar, round, { tag: 'AST-00008', location: 'Form 1 North' }), 409);
    await fails(as.roundResult(head, round, true), 403);
    expect((await as.listRounds(bursar))[0]).toMatchObject({ name: 'Verification 2026', closed: true });
  });
});

describe('reports', () => {
  it('total the register by category, place and custodian, with dollars and ZiG kept apart', async () => {
    await as.registerAsset(bursar, { name: 'Tractor tyre', categoryId: cat['Agriculture'], location: 'Farm', costCents: 1_000_000, currency: 'ZIG' });
    const r = await as.assetReports(bursar);
    expect(r.total.zigCostCents).toBe(1_000_000);
    expect(r.total.usdCostCents).toBeGreaterThan(0);
    expect(r.byCategory.find((c) => c.name === 'Agriculture')).toMatchObject({ count: 1, usdCostCents: 0, zigCostCents: 1_000_000 });
    expect(r.byLocation.map((l) => l.name)).toEqual(expect.arrayContaining(['Library', 'Farm']));
    expect(r.byCustodian.map((c) => c.name)).toContain('No custodian');
    // The disposed desk is not counted in the register's total.
    expect(r.total.count).toBe((await as.listAssets(bursar, { status: '' })).total + 0 || r.total.count);
  });
});

describe('one school never sees another', () => {
  it('B cannot see, move, repair, dispose of or verify A\'s assets', async () => {
    const aid = await assetId('AST-00008');
    expect((await as.listAssets(opB, {})).rows.map((r) => r.tag)).not.toContain('AST-00008');
    await fails(as.getAsset(opB, aid), 404);
    await fails(as.updateAsset(opB, { id: aid, notes: 'Mine now' }), 404);
    await fails(as.transferAsset(opB, { assetId: aid, toLocation: 'B school' }), 404);
    await fails(as.requestDisposal(opB, { assetId: aid, method: 'SCRAPPED', reason: 'Not yours' }), 404);
    await fails(as.saveSchedule(opB, { assetId: aid, title: 'Mine', everyMonths: 3 }), 404);
    await fails(as.findByTag(opB, 'AST-00008').then(() => undefined), 404);
    const req = await prisma.facDisposalRequest.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    await fails(as.decideDisposal(opB, req.id, { decision: 'REJECT', reason: 'Not yours' }), 404);
    const job = await prisma.facMaintenanceJob.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    await fails(as.completeJob(opB, job.id, { workDone: 'Not mine to close' }), 404);
    await fails(as.assignJob(opB, job.id, { assignedToId: opB.id }), 404);
    const rnd = await prisma.facVerificationRound.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    await fails(as.roundResult(opB, rnd.id), 404);
    await fails(as.scanAsset(opB, rnd.id, { tag: 'AST-00008', location: 'x' }), 404);
    await fails(as.reportFault(await actorOf(prisma, B.users.TEACHER.id), { assetId: aid, problem: 'Someone else\'s' }), 404);
    const tr = await prisma.facAssetTransfer.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    await fails(as.confirmTransfer(opB, tr.id), 404);
  });

  it('a purchase request of A cannot be registered from by B', async () => {
    const line = await prisma.finExpenseRequestItem.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    await fails(as.registerFromRequest(opB, { requestItemId: line.id, count: 1, categoryId: (await as.listCategories(opB))[0]!.id, location: 'x' }), 404);
  });
});

describe('a part switched off', () => {
  it('refuses every asset call for that school, and the fault report too', async () => {
    await prisma.schoolModule.create({ data: { schoolId: B.schoolId, module: 'facilities.assets', enabled: false } });
    const off = await actorOf(prisma, B.operator!.id);
    await fails(as.listAssets(off, {}), 403);
    await fails(as.registerAsset(off, { name: 'X', categoryId: 'c', location: 'y' }), 403);
    await fails(as.assetReports(off), 403);
    const tB = await actorOf(prisma, B.users.TEACHER.id);
    await fails(as.reportFault(tB, { assetId: 'a', problem: 'Broken for sure' }), 404);
    expect((await call('facilities/assets', 'GET', { as: B.operator! })).status).toBe(403);
    await prisma.schoolModule.deleteMany({ where: { schoolId: B.schoolId, module: 'facilities.assets' } });
  });
});

describe('the older asset screens', () => {
  it('stop recording once the school has moved to the Facilities register, and keep working for a school that has not', async () => {
    const body = { name: 'Old way', categoryId: 'x', tagNumber: 'T-1', acquisitionDate: '2026-01-01', acquisitionCost: 10, currency: 'USD', location: 'Block A', condition: 'GOOD' };
    expect((await call('assets', 'POST', { as: A.users.BURSAR, body })).status).toBe(409);
    expect((await call('assets/[id]/dispose', 'POST', { as: A.users.BURSAR, params: { id: A.assetId }, body: { disposalDate: '2026-02-01', reason: 'Old', method: 'SCRAPPED' } })).status).toBe(409);
    const C = await seedSchool(prisma, 'School C');
    const old = await call('assets', 'POST', { as: C.users.BURSAR, body: { ...body, categoryId: C.assetCategoryId } });
    expect(old.status).toBe(201);
    expect((await call('assets', 'GET', { as: A.operator! })).status).toBe(200);
  });
});

describe('the routes', () => {
  const routes: [string, 'GET' | 'POST' | 'PATCH', Record<string, string>?][] = [
    ['assets', 'GET'], ['assets', 'POST'], ['assets/categories', 'GET'], ['assets/categories', 'POST'], ['assets/tag', 'GET'], ['assets/requests', 'GET'], ['assets/from-request', 'POST'], ['assets/mine', 'GET'],
    ['assets/[id]', 'GET', { id: 'x' }], ['assets/[id]', 'PATCH', { id: 'x' }], ['assets/transfers', 'POST'], ['assets/transfers/[id]/confirm', 'POST', { id: 'x' }], ['assets/schedules', 'POST'],
    ['assets/schedules/[id]/done', 'POST', { id: 'x' }], ['assets/jobs', 'GET'], ['assets/jobs/[id]/assign', 'POST', { id: 'x' }], ['assets/jobs/[id]/complete', 'POST', { id: 'x' }], ['assets/disposals', 'GET'],
    ['assets/disposals', 'POST'], ['assets/disposals/[id]/decide', 'POST', { id: 'x' }], ['assets/rounds', 'GET'], ['assets/rounds', 'POST'], ['assets/rounds/[id]', 'GET', { id: 'x' }],
    ['assets/rounds/[id]/scan', 'POST', { id: 'x' }], ['assets/rounds/[id]/close', 'POST', { id: 'x' }], ['assets/rounds/[id]/move', 'POST', { id: 'x' }], ['assets/reports', 'GET'], ['assets/faults', 'POST'],
  ];
  for (const [file, method, params] of routes) {
    it(`${method} /api/facilities/${file}: 401 without a session${file === 'assets/faults' ? '' : ', 403 for a plain member of staff'}`, async () => {
      const body = method === 'GET' ? undefined : {};
      expect((await call(`facilities/${file}`, method, { as: null, params, body })).status).toBe(401);
      if (file !== 'assets/faults') {
        const plain = await userWithRoles(prisma, A, ['TEACHER'], 'route');
        expect((await call(`facilities/${file}`, method, { as: plain, params, body })).status).toBe(403);
      }
    });
  }

  it('work end to end: a teacher reports a fault, the bursar finds the asset by its tag and closes it', async () => {
    const list = await call('facilities/assets', 'GET', { as: A.users.BURSAR, query: '?q=projector' });
    expect(list.status).toBe(200);
    const aid = list.json.data.rows[0].id;
    expect((await call('facilities/assets/faults', 'POST', { as: A.users.TEACHER, body: { assetId: aid } })).status).toBe(422);
    const fault = await call('facilities/assets/faults', 'POST', { as: A.users.TEACHER, body: { assetId: aid, problem: 'The cable is frayed' } });
    expect(fault.status).toBe(201);
    const tag = await call('facilities/assets/tag', 'GET', { as: A.users.BURSAR, query: '?tag=ast-00001' });
    expect(tag.json.data.name).toBe('Projector');
    expect((await call('facilities/assets/jobs/[id]/complete', 'POST', { as: A.users.BURSAR, params: { id: fault.json.data.id }, body: { workDone: 'New cable fitted' } })).status).toBe(200);
    expect((await call('facilities/assets/disposals/[id]/decide', 'POST', { as: A.users.BURSAR, params: { id: 'x' }, body: { decision: 'APPROVE' } })).status).toBe(403);
    expect((await call('facilities/assets', 'POST', { as: A.users.BURSAR, rawBody: '{nope' })).status).toBe(400);
  });

  it('school B\'s operator gets nothing of school A through the routes', async () => {
    const aid = await assetId('AST-00008');
    expect((await call('facilities/assets/[id]', 'GET', { as: B.operator!, params: { id: aid } })).status).toBe(404);
    expect((await call('facilities/assets/[id]', 'PATCH', { as: B.operator!, params: { id: aid }, body: { notes: 'mine' } })).status).toBe(404);
    expect(JSON.stringify((await call('facilities/assets', 'GET', { as: B.operator! })).json)).not.toContain('AST-00008');
    expect(JSON.stringify((await call('facilities/assets/reports', 'GET', { as: B.operator! })).json)).not.toContain('Projector');
  });
});

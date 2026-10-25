// @vitest-environment node
// Facilities & Operations foundation, against a real PostgreSQL: money a learner owes becomes a Finance charge (or sits on the part's own
// ledger when Finance is off), pocket money and the tuck shop get their own funds, the settings are audited and per part, each part can
// be switched off for one school without touching another, and school A never sees or changes school B's facilities data.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, seedSchool, type SeededSchool } from '../helpers/seed';
import { actorOf } from '../helpers/academics';
import { addStudent } from '../helpers/students';
import { call } from '../helpers/route';
import { fails } from '../helpers/finance';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let prisma: typeof import('@/lib/prisma').prisma;
let money: typeof import('@/lib/facilities/money');
let common: typeof import('@/lib/facilities/common');
let settings: typeof import('@/lib/facilities/settings');
let scoped: typeof import('@/lib/scoped-db');
let A: SeededSchool;   // runs its money in Finance
let B: SeededSchool;   // Finance switched off
let C: SeededSchool;   // Finance on, still on the older accounting screens
let stA: string; let stB: string; let stC: string;

const tx = <T>(S: SeededSchool, fn: (db: import('@/lib/scoped-db').Db) => Promise<T>) => scoped.getScopedDb(S.schoolId, S.users.ADMIN.id).$tx(fn);
const fine = (S: SeededSchool, studentId: string, extra: Record<string, unknown> = {}) => ({
  schoolId: S.schoolId, actorId: S.users.TEACHER.id, studentId, part: 'LIBRARY' as const, kind: 'LIBRARY_FINE' as const, description: 'Library fine: Algebra, 3 days late',
  currency: 'USD' as const, amountCents: 150, sourceType: 'FacLoan', sourceId: 'loan-1', ...extra,
});

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  [money, common, settings, scoped] = await Promise.all([import('@/lib/facilities/money'), import('@/lib/facilities/common'), import('@/lib/facilities/settings'), import('@/lib/scoped-db')]);
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  C = await seedSchool(prisma, 'School C');
  await prisma.finSettings.create({ data: { schoolId: A.schoolId, legacyRetired: true } });
  await prisma.schoolModule.create({ data: { schoolId: B.schoolId, module: 'finance', enabled: false } });
  stA = (await addStudent(prisma, A, { firstName: 'Ann', surname: 'Alpha' })).id;
  stB = (await addStudent(prisma, B, { firstName: 'Bob', surname: 'Beta' })).id;
  stC = (await addStudent(prisma, C, { firstName: 'Cid', surname: 'Gamma' })).id;
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('money a learner owes because of a facilities service', () => {
  it('becomes a Finance charge, under its fee item and fund, when the school runs its money in Finance', async () => {
    const r = await tx(A, (db) => money.chargeLearner(db, fine(A, stA)));
    expect(r.where).toBe('FINANCE');
    expect(r.chargeId).toBeTruthy();
    expect(r.ledgerEntryId).toBeNull();
    const c = await prisma.finCharge.findUniqueOrThrow({ where: { id: r.chargeId! }, include: { fund: true } });
    expect(c).toMatchObject({ studentId: stA, schoolId: A.schoolId, amountCents: 150, currency: 'USD', source: 'FACILITIES', description: 'Library fine: Algebra, 3 days late' });
    expect(c.fund.code).toBe('GENERAL');
    const item = await prisma.feeItem.findFirstOrThrow({ where: { schoolId: A.schoolId, name: 'Library fine' } });
    expect(c.catalogItemId).toBe(item.id);
    // Never a second balance: nothing was written on the facilities ledger.
    expect(await prisma.facLedgerEntry.count({ where: { schoolId: A.schoolId } })).toBe(0);
  });

  it('each kind goes under its own fee item: boarding fee in the boarding fund, a lost book under its own name', async () => {
    const boarding = await tx(A, (db) => money.chargeLearner(db, fine(A, stA, { part: 'HOSTEL', kind: 'BOARDING', description: 'Boarding from 1 Feb', amountCents: 25000 })));
    const lost = await tx(A, (db) => money.chargeLearner(db, fine(A, stA, { kind: 'LOST_BOOK', description: 'Lost book: Physics', amountCents: 1200, currency: 'ZIG' })));
    const b = await prisma.finCharge.findUniqueOrThrow({ where: { id: boarding.chargeId! }, include: { fund: true } });
    const l = await prisma.finCharge.findUniqueOrThrow({ where: { id: lost.chargeId! }, include: { fund: true } });
    expect(b.fund.code).toBe('BOARDING');
    expect(l).toMatchObject({ currency: 'ZIG', amountCents: 1200 });
    expect((await prisma.feeItem.findFirstOrThrow({ where: { schoolId: A.schoolId, name: 'Lost or damaged book' } })).fundId).toBe(l.fundId);
  });

  it('is kept on the part\'s own ledger when Finance is switched off, and nothing else breaks', async () => {
    const r = await tx(B, (db) => money.chargeLearner(db, fine(B, stB)));
    expect(r).toMatchObject({ where: 'LEDGER', chargeId: null });
    const e = await prisma.facLedgerEntry.findUniqueOrThrow({ where: { id: r.ledgerEntryId! } });
    expect(e).toMatchObject({ schoolId: B.schoolId, studentId: stB, part: 'LIBRARY', amountCents: 150, currency: 'USD', status: 'OPEN', chargeId: null, sourceType: 'FacLoan', sourceId: 'loan-1' });
    expect(await prisma.finCharge.count({ where: { schoolId: B.schoolId } })).toBe(0);
    expect(await prisma.charge.count({ where: { schoolId: B.schoolId, label: { contains: 'Library fine' } } })).toBe(0);
    // The ledger entry has its own report line per currency.
    const totals = await prisma.facLedgerEntry.groupBy({ by: ['currency', 'part'], where: { schoolId: B.schoolId, status: 'OPEN' }, _sum: { amountCents: true } });
    expect(totals).toEqual([{ currency: 'USD', part: 'LIBRARY', _sum: { amountCents: 150 } }]);
  });

  it('is one charge on the older accounting screens for a school that has not moved to the new Finance, with a ledger entry that points at it', async () => {
    const r = await tx(C, (db) => money.chargeLearner(db, fine(C, stC)));
    expect(r).toMatchObject({ where: 'LEGACY', chargeId: null });
    const legacy = await prisma.charge.findFirstOrThrow({ where: { schoolId: C.schoolId, studentId: stC } });
    expect(Number(legacy.amount)).toBe(1.5);
    const e = await prisma.facLedgerEntry.findUniqueOrThrow({ where: { id: r.ledgerEntryId! } });
    expect(e).toMatchObject({ sourceType: 'LEGACY_CHARGE', sourceId: legacy.id });
    expect(await prisma.finCharge.count({ where: { schoolId: C.schoolId } })).toBe(0);
  });

  it('refuses an amount that is not whole cents above zero, and a learner of another school', async () => {
    for (const amountCents of [0, -5, 1.5, 3_000_000_000]) await fails(tx(A, (db) => money.chargeLearner(db, fine(A, stA, { amountCents }))), 422);
    await fails(tx(A, (db) => money.chargeLearner(db, fine(A, stB))), 404);
  });

  it('keeps USD and ZiG apart on the ledger', async () => {
    await tx(B, (db) => money.chargeLearner(db, fine(B, stB, { currency: 'ZIG', amountCents: 5000, description: 'Fine in ZiG' })));
    const totals = await prisma.facLedgerEntry.groupBy({ by: ['currency'], where: { schoolId: B.schoolId }, _sum: { amountCents: true }, orderBy: { currency: 'asc' } });
    expect(totals.map((x) => [x.currency, x._sum.amountCents])).toEqual([['USD', 150], ['ZIG', 5000]]);
  });
});

describe('pocket money and the tuck shop have their own funds', () => {
  it('are made once, apart from every fee fund, and never picked for a fee charge', async () => {
    const f1 = await tx(A, (db) => money.ensureFacilityFunds(db, A.schoolId));
    const f2 = await tx(A, (db) => money.ensureFacilityFunds(db, A.schoolId));
    expect(f1.trust).toMatchObject({ code: 'POCKET', name: 'Pocket money (held in trust)', kind: 'TRUST' });
    expect(f1.tuckshop).toMatchObject({ code: 'TUCKSHOP', name: 'Tuck shop', kind: 'TUCKSHOP' });
    expect(f2.trust.id).toBe(f1.trust.id);
    expect(await prisma.fund.count({ where: { schoolId: A.schoolId, code: { in: ['POCKET', 'TUCKSHOP'] } } })).toBe(2);
    expect(await prisma.fund.count({ where: { schoolId: B.schoolId, code: 'POCKET' } })).toBe(0);
    const fees = await prisma.feeItem.findMany({ where: { schoolId: A.schoolId } });
    expect(fees.map((x) => x.fundId)).not.toContain(f1.trust.id);
    const charges = await prisma.finCharge.findMany({ where: { schoolId: A.schoolId } });
    expect(charges.map((x) => x.fundId)).not.toContain(f1.trust.id);
    expect(charges.map((x) => x.fundId)).not.toContain(f1.tuckshop.id);
  });
});

describe('numbers', () => {
  it('are never repeated or skipped when two people ask at once', async () => {
    const got = await Promise.all(Array.from({ length: 8 }, () => tx(A, (db) => common.nextFacNumber(db, A.schoolId, 'AST'))));
    expect([...got].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await tx(B, (db) => common.nextFacNumber(db, B.schoolId, 'AST'))).toBe(1);
    expect(common.padNumber(412)).toBe('00412');
  });
});

describe('settings', () => {
  it('start with the brief\'s defaults', async () => {
    const admin = await actorOf(prisma, A.users.ADMIN.id);
    expect(await settings.getFacSettings(admin)).toMatchObject({
      learnerMaxLoans: 2, learnerLoanDays: 14, staffMaxLoans: 5, staffLoanDays: 30, exeatHeadAlertMinutes: 120, longExeatNights: 3, expiryWarningDays: 30,
      prorateTransport: true, rollCallSessions: ['MORNING', 'EVENING', 'LIGHTS_OUT'],
    });
  });

  it('change with an audit row that holds the before and after, and only the changed fields', async () => {
    const admin = await actorOf(prisma, A.users.ADMIN.id);
    const after = await settings.updateFacSettings(admin, { learnerMaxLoans: 3, lateFinePerDayCents: 25, lateFineCurrency: 'USD', learnerLoanDays: 14 });
    expect(after).toMatchObject({ learnerMaxLoans: 3, lateFinePerDayCents: 25, learnerLoanDays: 14 });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'FAC_SAVE_SETTINGS' }, orderBy: { createdAt: 'desc' } });
    expect(log.actorId).toBe(A.users.ADMIN.id);
    expect(log.before).toEqual({ learnerMaxLoans: 2, lateFinePerDayCents: 0 });
    expect(log.after).toEqual({ learnerMaxLoans: 3, lateFinePerDayCents: 25 });
  });

  it('are validated on the server', async () => {
    const admin = await actorOf(prisma, A.users.ADMIN.id);
    for (const bad of [{ learnerLoanDays: 0 }, { learnerMaxLoans: -1 }, { lateFinePerDayCents: 1.5 }, { rollCallSessions: [] }, { lateFineCurrency: 'EUR' }, { nonsense: 1 }, { learnerMaxLoans: '3' }]) {
      await fails(settings.updateFacSettings(admin, bad), 422);
    }
    await fails(settings.updateFacSettings(admin, {}), 422);
  });

  it('each setting needs the permission of its own part', async () => {
    await grantPermission(prisma, A.schoolId, 'LIBRARIAN', 'facilities.library.manage');
    await grantPermission(prisma, A.schoolId, 'LIBRARIAN', 'facilities.library.view');
    const librarian = await actorOf(prisma, A.users.LIBRARIAN.id);
    await settings.updateFacSettings(librarian, { staffMaxLoans: 6 });
    await fails(settings.updateFacSettings(librarian, { staffMaxLoans: 7, disposalOwnerLimitUsdCents: 100000 }), 403);
    await fails(settings.updateFacSettings(librarian, { rollCallSessions: ['MORNING'] }), 403);
    expect((await settings.getFacSettings(librarian)).staffMaxLoans).toBe(6);
    const teacher = await actorOf(prisma, A.users.TEACHER.id);
    await fails(settings.getFacSettings(teacher), 403);
    await fails(settings.updateFacSettings(teacher, { learnerMaxLoans: 9 }), 403);
  });

  it('are per school: changing them in A does not touch B', async () => {
    const adminB = await actorOf(prisma, B.users.ADMIN.id);
    expect((await settings.getFacSettings(adminB)).learnerMaxLoans).toBe(2);
    expect((await settings.getFacSettings(adminB)).staffMaxLoans).toBe(5);
  });
});

describe('a part switched off for one school', () => {
  it('refuses its permissions and its settings there, and nowhere else', async () => {
    await prisma.schoolModule.create({ data: { schoolId: B.schoolId, module: 'facilities.library', enabled: false } });
    const adminB = await actorOf(prisma, B.users.ADMIN.id);
    const adminA = await actorOf(prisma, A.users.ADMIN.id);
    const { can } = await import('@/lib/access-core');
    expect(can(adminB, 'facilities.library.desk')).toBe(false);
    expect(can(adminB, 'facilities.hostel.view')).toBe(true);
    expect(can(adminA, 'facilities.library.desk')).toBe(true);
    await fails(settings.updateFacSettings(adminB, { learnerMaxLoans: 4 }), 403);
    await scoped.getScopedDb(B.schoolId).$tx(async (db) => {
      expect(await common.partOn(db, B.schoolId, 'library')).toBe(false);
      expect(await common.partOn(db, B.schoolId, 'hostel')).toBe(true);
    });
    await scoped.getScopedDb(A.schoolId).$tx(async (db) => expect(await common.partOn(db, A.schoolId, 'library')).toBe(true));
  });

  it('switching the whole of Facilities off turns every part off, and a service that skipped the route still refuses', async () => {
    await prisma.schoolModule.create({ data: { schoolId: C.schoolId, module: 'facilities', enabled: false } });
    const adminC = await actorOf(prisma, C.users.ADMIN.id);
    await fails(settings.updateFacSettings(adminC, { prorateTransport: false }), 403);
    await scoped.getScopedDb(C.schoolId).$tx(async (db) => {
      for (const p of ['hostel', 'exeats', 'sickbay', 'tuckshop', 'library', 'transport', 'inventory', 'assets'] as const) expect(await common.partOn(db, C.schoolId, p), p).toBe(false);
      await fails(common.assertPartOn(db, C.schoolId, 'hostel'), 404);
    });
  });
});

describe('the settings route', () => {
  it('401 without a session, 403 without a facilities key, and works for the Administrator', async () => {
    expect((await call('facilities/settings', 'GET', { as: null })).status).toBe(401);
    expect((await call('facilities/settings', 'PATCH', { as: null, body: {} })).status).toBe(401);
    expect((await call('facilities/settings', 'GET', { as: A.users.TEACHER })).status).toBe(403);
    expect((await call('facilities/settings', 'PATCH', { as: A.users.TEACHER, body: { learnerMaxLoans: 5 } })).status).toBe(403);
    const ok = await call('facilities/settings', 'GET', { as: A.users.ADMIN });
    expect(ok.status).toBe(200);
    expect(ok.json.data).toMatchObject({ learnerMaxLoans: 3 });
  });

  it('validates the body (422) and saves a good one', async () => {
    expect((await call('facilities/settings', 'PATCH', { as: A.users.ADMIN, body: { learnerLoanDays: 0 } })).status).toBe(422);
    expect((await call('facilities/settings', 'PATCH', { as: A.users.ADMIN, rawBody: '{nope' })).status).toBe(400);
    const r = await call('facilities/settings', 'PATCH', { as: A.users.ADMIN, body: { learnerLoanDays: 21 } });
    expect(r.status).toBe(200);
    expect(r.json.data.learnerLoanDays).toBe(21);
  });

  it('school A cannot see or change school B: each administrator reaches only their own row', async () => {
    const beforeB = await prisma.facSettings.findUnique({ where: { schoolId: B.schoolId } });
    const r = await call('facilities/settings', 'PATCH', { as: A.users.ADMIN, body: { staffLoanDays: 40 } });
    expect(r.status).toBe(200);
    const afterB = await prisma.facSettings.findUnique({ where: { schoolId: B.schoolId } });
    expect(afterB?.staffLoanDays ?? 30).toBe(beforeB?.staffLoanDays ?? 30);
    expect((await prisma.facSettings.findUniqueOrThrow({ where: { schoolId: A.schoolId } })).staffLoanDays).toBe(40);
    // B's administrator reads B's own numbers, not A's.
    const own = await call('facilities/settings', 'GET', { as: B.users.ADMIN });
    expect(own.status).toBe(200);
    expect(own.json.data.staffLoanDays).toBe(30);
  });

  it('a part that is off for the school refuses its settings even though other parts are on', async () => {
    const r = await call('facilities/settings', 'PATCH', { as: B.users.ADMIN, body: { learnerMaxLoans: 6 } });
    expect(r.status).toBe(403);
    const ok = await call('facilities/settings', 'PATCH', { as: B.users.ADMIN, body: { longExeatNights: 4 } });
    expect(ok.status).toBe(200);
  });
});

describe('the scoped database', () => {
  it('never returns another school\'s facilities rows, and refuses to write one', async () => {
    await tx(A, (db) => db.facStore.create({ data: { schoolId: A.schoolId, name: 'Main store' } }));
    await tx(B, (db) => db.facStore.create({ data: { schoolId: B.schoolId, name: 'Kitchen' } }));
    const seenByA = await tx(A, (db) => db.facStore.findMany());
    expect(seenByA.map((s) => s.name)).toEqual(['Main store']);
    await expect(tx(A, (db) => db.facStore.create({ data: { schoolId: B.schoolId, name: 'Smuggled' } }))).rejects.toThrow(/another school/);
    expect(await tx(A, (db) => db.facStore.findFirst({ where: { name: 'Kitchen' } }))).toBeNull();
    const kitchen = await prisma.facStore.findFirstOrThrow({ where: { schoolId: B.schoolId } });
    expect(await tx(A, (db) => db.facStore.updateMany({ where: { id: kitchen.id }, data: { active: false } }))).toMatchObject({ count: 0 });
    // And a record is never deleted, whoever asks.
    await expect(prisma.facStore.delete({ where: { id: kitchen.id } })).rejects.toThrow();
  });
});

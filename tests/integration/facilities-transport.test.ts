// @vitest-environment node
// Transport against a real PostgreSQL: a trip is refused for a vehicle or driver whose papers have run out (in the code and in the database),
// a route never carries more learners than its vehicle has seats, the transport fee is charged (prorated from the day the learner joins when
// the school says so), fuel becomes a Finance expense, a vehicle or driver is never booked twice for the same time, and the person who asked
// for a booking does not approve it.
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
let tr: typeof import('@/lib/facilities/transport');
let scoped: typeof import('@/lib/scoped-db');
let A: SeededSchool; let B: SeededSchool;
let op: Actor; let boss2: Actor; let plain: Actor; let opB: Actor;
const kid: Record<string, string> = {};
const id: Record<string, string> = {};
const today = () => new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);
const plus = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const DAY = 86_400_000;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  [tr, scoped] = await Promise.all([import('@/lib/facilities/transport'), import('@/lib/scoped-db')]);
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  await prisma.finSettings.create({ data: { schoolId: A.schoolId, legacyRetired: true } });
  const plainU = await userWithRoles(prisma, A, ['TEACHER'], 'plain');
  for (const [k, n] of [['a', 'Anna'], ['b', 'Bela'], ['c', 'Cara']] as const) kid[k] = (await addStudent(prisma, A, { firstName: n, surname: 'Rider', gender: 'F', boarding: 'DAY' })).id;
  kid.other = (await addStudent(prisma, B, { firstName: 'Other', surname: 'School', gender: 'M', boarding: 'DAY' })).id;
  [op, boss2, plain, opB] = await Promise.all([actorOf(prisma, A.operator!.id), actorOf(prisma, A.operator2!.id), actorOf(prisma, plainU.id), actorOf(prisma, B.operator!.id)]);
  const emp = await prisma.employee.create({ data: { schoolId: A.schoolId, employeeNo: 'E-DRV', firstName: 'Dan', surname: 'Driver', jobTitle: 'Driver', startDate: new Date('2020-01-01'), createdById: A.users.ADMIN.id } });
  id.emp = emp.id;
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('vehicles, drivers and their papers', () => {
  it('sets up a two-seat vehicle, a driver and a route with stops', async () => {
    id.veh = (await tr.saveVehicle(op, { registration: 'abc 123', make: 'Toyota', model: 'Quantum', seats: 2 })).id;
    await fails(tr.saveVehicle(op, { registration: 'ABC 123', make: 'Toyota', seats: 14 }), 409, /already/);
    await fails(tr.saveVehicle(plain, { registration: 'XYZ 9', make: 'Isuzu', seats: 30 }), 403);
    id.drv = (await tr.saveDriver(op, { employeeId: id.emp, licenceClass: '2' })).id;
    await fails(tr.saveDriver(op, { employeeId: 'not-in-this-school', licenceClass: '2' }), 404);
    id.route = (await tr.saveRoute(op, { name: 'Northern suburbs', zone: 'North', amTime: '06:30', pmTime: '16:00', vehicleId: id.veh, driverId: id.drv, feeCents: 9000, currency: 'USD' })).id;
    await fails(tr.saveRoute(op, { name: 'Northern suburbs', feeCents: 0 }), 409);
    id.s1 = (await tr.saveStop(op, { routeId: id.route, name: 'Borrowdale shops', sequence: 1, amPickupTime: '06:40' })).id;
    id.s2 = (await tr.saveStop(op, { routeId: id.route, name: 'Mount Pleasant', sequence: 2 })).id;
    await fails(tr.saveStop(op, { routeId: id.route, name: 'Duplicate', sequence: 1 }), 409);
  });

  it('refuses a trip with no papers, and with an expired paper, and allows it once they are renewed', async () => {
    const trip = { routeId: id.route, date: today(), odometerStart: 1000, odometerEnd: 1040 };
    await fails(tr.recordTrip(op, trip), 409, /no vehicle licence on record/);
    for (const type of ['LICENCE', 'INSURANCE', 'FITNESS'] as const) await tr.addVehicleDoc(op, id.veh!, { type, expiry: plus(200), number: `${type}-1` });
    await fails(tr.recordTrip(op, trip), 409, /no driving licence on record/);
    await tr.addDriverDoc(op, id.drv!, { type: 'DRIVING_LICENCE', expiry: plus(300) });
    await tr.addVehicleDoc(op, id.veh!, { type: 'INSURANCE', expiry: plus(-2) }); // an older paper does not count: the newest does
    expect((await tr.recordTrip(op, trip)).id).toBeTruthy();
  });

  it('is held by the database too: no trip row for a vehicle with an expired paper', async () => {
    const veh2 = await prisma.facVehicle.create({ data: { schoolId: A.schoolId, registration: 'OLD 1', make: 'Old', seats: 10 } });
    await expect(t.pg.query(`INSERT INTO "FacTrip" ("id","schoolId","routeId","vehicleId","driverId","date","recordedById","updatedAt") VALUES ('t1','${A.schoolId}','${id.route}','${veh2.id}','${id.drv}','${today()}','${op.id}',now())`)).rejects.toThrow(/No trip can be recorded/);
    await prisma.facVehicleDocument.createMany({ data: ['LICENCE', 'INSURANCE', 'FITNESS'].map((type) => ({ schoolId: A.schoolId, vehicleId: veh2.id, type: type as 'LICENCE', expiry: new Date(Date.now() - 5 * DAY) })) });
    await expect(t.pg.query(`INSERT INTO "FacTrip" ("id","schoolId","routeId","vehicleId","driverId","date","recordedById","updatedAt") VALUES ('t2','${A.schoolId}','${id.route}','${veh2.id}','${id.drv}','${today()}','${op.id}',now())`)).rejects.toThrow(/ran out/);
    await prisma.facDriverDocument.create({ data: { schoolId: A.schoolId, driverId: id.drv!, type: 'DEFENSIVE_DRIVING', expiry: new Date(Date.now() - DAY) } });
    await fails(tr.recordTrip(op, { routeId: id.route, date: today() }), 409, /defensive driving certificate ran out/);
    await tr.addDriverDoc(op, id.drv!, { type: 'DEFENSIVE_DRIVING', expiry: plus(100) });
    expect((await tr.recordTrip(op, { routeId: id.route, date: today(), leg: 'AFTERNOON' })).id).toBeTruthy();
  });

  it('tells the transport manager before a paper runs out, once', async () => {
    await tr.addVehicleDoc(op, id.veh!, { type: 'ROUTE_PERMIT', expiry: plus(10) });
    const run = () => scoped.getScopedDb(A.schoolId, op.id).$tx((tx) => tr.documentAlerts(tx, A.schoolId));
    expect(await run()).toBeGreaterThanOrEqual(1);
    expect(await run()).toBe(0);
    expect(await prisma.notification.count({ where: { schoolId: A.schoolId, title: { contains: 'Route permit runs out soon' } } })).toBeGreaterThanOrEqual(1);
  });
});

describe('learners on a route', () => {
  it('charges the term fee, stops at the vehicle\'s seats, and keeps the row when a learner leaves', async () => {
    await fails(tr.assignLearner(plain, { studentId: kid.a, routeId: id.route, amStopId: id.s1 }), 403);
    await fails(tr.assignLearner(op, { studentId: kid.a, routeId: id.route, amStopId: 'nope' }), 422);
    await fails(tr.assignLearner(op, { studentId: kid.other, routeId: id.route, amStopId: id.s1 }), 404);
    const a = await tr.assignLearner(op, { studentId: kid.a, routeId: id.route, amStopId: id.s1, pmStopId: id.s2 });
    expect(a.chargedCents).toBeGreaterThan(0);
    expect(a.chargedCents).toBeLessThanOrEqual(9000);
    const charge = await prisma.finCharge.findUniqueOrThrow({ where: { id: a.chargeId! } });
    expect(charge.amountCents).toBe(a.chargedCents);
    expect(charge.source).toBe('FACILITIES');
    await fails(tr.assignLearner(op, { studentId: kid.a, routeId: id.route, amStopId: id.s1 }), 409, /already on a route/);
    await tr.assignLearner(op, { studentId: kid.b, routeId: id.route, amStopId: id.s1 });
    await fails(tr.assignLearner(op, { studentId: kid.c, routeId: id.route, amStopId: id.s1 }), 409, /seats/);
    await tr.removeLearner(op, { studentId: kid.b, reason: 'Moved house' });
    expect(await prisma.facStudentRoute.count({ where: { studentId: kid.b } })).toBe(1);
    // The seat is free again.
    expect((await tr.assignLearner(op, { studentId: kid.c, routeId: id.route, amStopId: id.s2 })).id).toBeTruthy();
    expect((await tr.routeLearners(op, id.route!)).map((l) => l.name).sort()).toEqual(['Anna Rider', 'Cara Rider']);
  });

  it('prorates from the day a learner joins', () => {
    expect(tr.proratedFee(9000, '2026-09-01', '2026-12-04', '2026-09-01')).toBe(9000);
    expect(tr.proratedFee(9000, '2026-09-01', '2026-12-04', '2026-10-17')).toBe(Math.round((9000 * 49) / 95));
    expect(tr.proratedFee(9000, '2026-09-01', '2026-12-04', '2027-01-01')).toBe(Math.round(9000 / 95));
  });

  it('refuses a boarded learner who is not on the route', async () => {
    await fails(tr.recordTrip(op, { routeId: id.route, date: today(), boardedStudentIds: [kid.b] }), 422, /not on this route/);
    const ok = await tr.recordTrip(op, { routeId: id.route, date: today(), boardedStudentIds: [kid.a, kid.c], odometerStart: 1040, odometerEnd: 1080 });
    expect(ok.boarded).toBe(2);
    await fails(tr.recordTrip(op, { routeId: id.route, date: today(), odometerStart: 500, odometerEnd: 100 }), 422);
    await fails(tr.recordTrip(op, { routeId: id.route, date: plus(3) }), 422);
    await fails(tr.recordTrip(plain, { routeId: id.route, date: today() }), 403);
  });
});

describe('fuel and the report', () => {
  it('records fuel as a Finance expense, and works out cost per kilometre', async () => {
    const f = await tr.logFuel(op, { vehicleId: id.veh, litres: 40, costCents: 6000, currency: 'USD', odometerKm: 1080 });
    expect(f.expense).toBe('FINANCE');
    const row = await prisma.facFuelLog.findUniqueOrThrow({ where: { id: f.id } });
    const exp = await prisma.finExpense.findUniqueOrThrow({ where: { id: row.expenseId! } });
    expect(exp).toMatchObject({ amountCents: 6000, category: 'Transport and fuel' });
    await fails(tr.logFuel(op, { vehicleId: id.veh, litres: 0, costCents: 100 }), 422);
    await fails(tr.logFuel(plain, { vehicleId: id.veh, litres: 5, costCents: 100 }), 403);
    await fails(tr.logFuel(op, { vehicleId: 'not-in-this-school', litres: 5, costCents: 100 }), 404);
    const rep = await tr.transportReport(op);
    const v = rep.perVehicle.find((x) => x.vehicleId === id.veh)!;
    expect(v.km).toBe(80);
    expect(v.litres).toBe(40);
    expect(v.kmPerLitre).toBe(2);
    expect(v.costPerKm).toEqual([{ currency: 'USD', cents: 75 }]);
  });
});

describe('bookings', () => {
  const when = (h: number, len = 4) => ({ startAt: new Date(Date.now() + h * 3_600_000).toISOString(), endAt: new Date(Date.now() + (h + len) * 3_600_000).toISOString() });

  it('is never double-booked, and is approved by someone other than the person who asked', async () => {
    const b = await tr.requestBooking(op, { vehicleId: id.veh, driverId: id.drv, ...when(48), purpose: 'Netball fixture', destination: 'Peterhouse', perLearnerCents: 500, currency: 'USD' });
    await fails(tr.requestBooking(boss2, { vehicleId: id.veh, ...when(50, 2), purpose: 'Clash by vehicle' }), 409, /already booked/);
    await fails(tr.requestBooking(boss2, { vehicleId: id.veh, ...when(60, 0), purpose: 'Backwards' }), 422);
    await expect(t.pg.query(`INSERT INTO "FacVehicleBooking" ("id","schoolId","vehicleId","startAt","endAt","purpose","requestedById","updatedAt") VALUES ('b1','${A.schoolId}','${id.veh}','${when(49, 1).startAt}','${when(49, 1).endAt}','Clash','${op.id}',now())`)).rejects.toThrow(/already booked/);
    await fails(tr.decideBooking(op, b.id, { decision: 'APPROVE' }), 403);
    await fails(tr.decideBooking(boss2, b.id, { decision: 'REJECT' }), 422);
    expect((await tr.decideBooking(boss2, b.id, { decision: 'APPROVE' })).status).toBe('APPROVED');
    await fails(tr.decideBooking(boss2, b.id, { decision: 'APPROVE' }), 409);
    id.booking = b.id;
  });

  it('bills the learners going on a school trip once each, within the seats', async () => {
    const r = await tr.addBookingPassengers(op, id.booking!, { studentIds: [kid.a, kid.b] });
    expect(r).toEqual({ added: 2, billed: 2 });
    const charges = await prisma.finCharge.findMany({ where: { studentId: kid.a, description: { contains: 'School trip' } } });
    expect(charges).toHaveLength(1);
    expect(charges[0]!.amountCents).toBe(500);
    expect((await tr.addBookingPassengers(op, id.booking!, { studentIds: [kid.a] })).added).toBe(0);
    await fails(tr.addBookingPassengers(op, id.booking!, { studentIds: [kid.c] }), 409, /seats/);
    expect((await tr.listBookings(op)).find((x) => x.id === id.booking)).toMatchObject({ status: 'APPROVED', learners: 2 });
  });

  it('lets a cancelled booking free the vehicle', async () => {
    await tr.decideBooking(boss2, id.booking!, { decision: 'CANCEL', reason: 'Fixture postponed' });
    expect((await tr.requestBooking(boss2, { vehicleId: id.veh, ...when(49, 1), purpose: 'Now free' })).id).toBeTruthy();
  });
});

describe('another school', () => {
  it('cannot see or change this school\'s transport', async () => {
    expect((await tr.fleet(opB)).vehicles).toEqual([]);
    expect(await tr.listRoutes(opB)).toEqual([]);
    await fails(tr.routeLearners(opB, id.route!), 404);
    await fails(tr.assignLearner(opB, { studentId: kid.a, routeId: id.route, amStopId: id.s1 }), 404);
    await fails(tr.addVehicleDoc(opB, id.veh!, { type: 'LICENCE', expiry: plus(300) }), 404);
    await fails(tr.recordTrip(opB, { routeId: id.route }), 404);
    await fails(tr.decideBooking(opB, id.booking!, { decision: 'APPROVE' }), 404);
  });
});

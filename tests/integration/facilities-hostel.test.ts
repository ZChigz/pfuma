// @vitest-environment node
// The hostel against a real PostgreSQL: only a boarder can have a bed (a day scholar is changed to a boarder first, which adds the boarding
// charge), moving keeps history, a boarding master reaches only their own hostel, the roll call fills in learners on exeat, in the sick bay or
// suspended and locks them, an unexplained Absent at lights out alerts the boarding master and the Deputy, and inspections charge damage only
// when approved.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, userWithRoles, type SeededSchool } from '../helpers/seed';
import { actorOf } from '../helpers/academics';
import { addStudent } from '../helpers/students';
import { call } from '../helpers/route';
import { fails } from '../helpers/finance';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

type Actor = Awaited<ReturnType<typeof actorOf>>;
let t: TestDb;
let prisma: typeof import('@/lib/prisma').prisma;
let hs: typeof import('@/lib/facilities/hostel');
let settings: typeof import('@/lib/facilities/settings');
let billing: typeof import('@/lib/finance/billing');
let structures: typeof import('@/lib/finance/structures');
let attendance: typeof import('@/lib/academics/attendance');
let scoped: typeof import('@/lib/scoped-db');
let A: SeededSchool; let B: SeededSchool;
let op: Actor; let opB: Actor; let bm: Actor; let bm2: Actor; let matron: Actor; let plain: Actor; let deputy: Actor;
const kid: Record<string, string> = {};
const h: Record<string, string> = {};
const bed: Record<string, string[]> = {};
const today = () => new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  [hs, settings, billing, structures, attendance, scoped] = await Promise.all([import('@/lib/facilities/hostel'), import('@/lib/facilities/settings'), import('@/lib/finance/billing'), import('@/lib/finance/structures'), import('@/lib/academics/attendance'), import('@/lib/scoped-db')]);
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  await prisma.finSettings.create({ data: { schoolId: A.schoolId, legacyRetired: true } });
  await prisma.schoolModule.create({ data: { schoolId: B.schoolId, module: 'finance', enabled: false } });
  const bmU = await userWithRoles(prisma, A, ['BOARDING_MASTER'], 'bm');
  const bm2U = await userWithRoles(prisma, A, ['BOARDING_MASTER'], 'bm2');
  const matronU = await userWithRoles(prisma, A, ['MATRON'], 'matron');
  const plainU = await userWithRoles(prisma, A, ['TEACHER'], 'plain');
  const deputyU = await userWithRoles(prisma, A, ['DEPUTY_HEAD'], 'deputy');
  const mk = async (key: string, boarding: 'DAY' | 'BOARDER', gender: 'M' | 'F', name: string, classId?: string) => { kid[key] = (await addStudent(prisma, A, { firstName: name, surname: 'Learner', gender, boarding, classId })).id; };
  await mk('b1', 'BOARDER', 'M', 'Alpha'); await mk('b2', 'BOARDER', 'M', 'Bravo'); await mk('b3', 'BOARDER', 'M', 'Charlie'); await mk('b4', 'BOARDER', 'M', 'Delta');
  await mk('g1', 'BOARDER', 'F', 'Grace'); await mk('d1', 'DAY', 'M', 'Dayo'); await mk('d2', 'DAY', 'F', 'Dayna');
  kid.other = (await addStudent(prisma, B, { firstName: 'Other', surname: 'School', gender: 'M', boarding: 'BOARDER' })).id;
  [op, opB, bm, bm2, matron, plain, deputy] = await Promise.all([actorOf(prisma, A.operator!.id), actorOf(prisma, B.operator!.id), actorOf(prisma, bmU.id), actorOf(prisma, bm2U.id), actorOf(prisma, matronU.id), actorOf(prisma, plainU.id), actorOf(prisma, deputyU.id)]);
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('structure', () => {
  it('a hostel has rooms and beds, numbered after the ones already there', async () => {
    h.boys = (await hs.saveHostel(op, { name: 'Moyo House', gender: 'M', boardingMasterId: bm.id, matronId: matron.id, capacity: 6 })).id;
    h.girls = (await hs.saveHostel(op, { name: 'Dube House', gender: 'F', boardingMasterId: bm2.id, capacity: 4 })).id;
    const r1 = (await hs.saveRoom(op, { hostelId: h.boys, name: 'Room 1', floor: 'Ground', capacity: 4 })).id;
    const r2 = (await hs.saveRoom(op, { hostelId: h.boys, name: 'Room 2', floor: 'Ground', capacity: 2 })).id;
    const gr = (await hs.saveRoom(op, { hostelId: h.girls, name: 'Room A', capacity: 4 })).id;
    expect((await hs.addBeds(op, { roomId: r1, count: 3, lockerPrefix: 'L' })).added).toEqual(['1', '2', '3']);
    expect((await hs.addBeds(op, { roomId: r1, count: 1, bedType: 'BUNK_TOP' })).added).toEqual(['4']);
    await hs.addBeds(op, { roomId: r2, numbers: ['1', '2'] });
    await hs.addBeds(op, { roomId: gr, count: 2 });
    const data = await hs.getHostel(op, h.boys);
    bed.r1 = data.rooms.find((r) => r.name === 'Room 1')!.beds.map((b) => b.id);
    bed.r2 = data.rooms.find((r) => r.name === 'Room 2')!.beds.map((b) => b.id);
    bed.g = (await hs.getHostel(op, h.girls)).rooms[0]!.beds.map((b) => b.id);
    expect(data.rooms[0]!.beds[0]).toMatchObject({ number: '1', locker: 'L1', studentId: null });
    expect(data.rooms[0]!.beds[3]).toMatchObject({ number: '4', bedType: 'BUNK_TOP' });
    await fails(hs.addBeds(op, { roomId: r1, numbers: ['2'] }), 409, /already exists/);
    await fails(hs.addBeds(op, { roomId: r1, numbers: ['9', '9'] }), 422);
    await fails(hs.saveRoom(op, { hostelId: h.boys, name: 'Room 1' }), 409);
    await fails(hs.saveHostel(op, { name: 'Moyo House', gender: 'M' }), 409);
  });

  it('is kept by the people who manage the hostel, and a boarding master reaches only their own', async () => {
    await fails(hs.saveHostel(plain, { name: 'Sneaky', gender: 'M' }), 403);
    await fails(hs.saveHostel(matron, { name: 'Sneaky', gender: 'M' }), 403);
    const rooms = (await hs.getHostel(bm, h.boys)).rooms;
    await hs.saveRoom(bm, { hostelId: h.boys, name: 'Room 3' });
    expect(rooms.length).toBeGreaterThan(0);
    await fails(hs.saveRoom(bm, { hostelId: h.girls, name: 'Room B' }), 403);
    await fails(hs.getHostel(bm, h.girls), 403);
    expect((await hs.listHostels(bm)).map((x) => x.name)).toEqual(['Moyo House']);
    expect((await hs.listHostels(bm2)).map((x) => x.name)).toEqual(['Dube House']);
    expect((await hs.listHostels(op)).map((x) => x.name).sort()).toEqual(['Dube House', 'Moyo House']);
    await fails(hs.listHostels(plain), 403);
  });
});

describe('giving a bed', () => {
  it('to a boarder, in a hostel for their gender, with the history kept when they move', async () => {
    const a = await hs.allocateBed(bm, { studentId: kid.b1, bedId: bed.r1![0] });
    expect(a.movedFrom).toBeNull();
    const row = await prisma.facBedAllocation.findUniqueOrThrow({ where: { id: a.allocationId } });
    expect(row).toMatchObject({ studentId: kid.b1, bedId: bed.r1![0], toDate: null, allocatedById: bm.id });
    expect((await hs.getHostel(bm, h.boys)).rooms[0]!.beds[0]).toMatchObject({ studentId: kid.b1, student: 'Alpha Learner' });
    // Moving ends the old allocation today and starts a new one.
    const moved = await hs.allocateBed(bm, { studentId: kid.b1, bedId: bed.r1![1] });
    expect(moved.movedFrom).toBe(bed.r1![0]);
    const hist = await hs.bedHistory(op, kid.b1!);
    expect(hist).toHaveLength(2);
    expect(hist.map((x) => [x.bed, x.to === null])).toEqual([['2', true], ['1', false]]);
    await fails(hs.allocateBed(bm, { studentId: kid.b1, bedId: bed.r1![1] }), 409, /already in that bed/);
    await fails(hs.allocateBed(bm, { studentId: kid.b2, bedId: bed.r1![1] }), 409, /taken/);
    await hs.allocateBed(bm, { studentId: kid.b2, bedId: bed.r1![0] });
  });

  it('not to a girl in the boys\' hostel, not to a learner of another school, not outside the boarding master\'s own hostel', async () => {
    await fails(hs.allocateBed(bm, { studentId: kid.g1, bedId: bed.r1![2] }), 409, /for boys/);
    await fails(hs.allocateBed(op, { studentId: kid.other, bedId: bed.r1![2] }), 404);
    await fails(hs.allocateBed(bm, { studentId: kid.g1, bedId: bed.g![0] }), 403);
    await fails(hs.allocateBed(plain, { studentId: kid.g1, bedId: bed.g![0] }), 403);
    await hs.allocateBed(bm2, { studentId: kid.g1, bedId: bed.g![0] });
  });

  it('a day scholar needs to be changed to a boarder first, and that adds the boarding charge from that date', async () => {
    // The term has been billed: tuition for everyone, a boarding fee for boarders only.
    const bursarU = await actorOf(prisma, A.users.BURSAR.id);
    const headU = await actorOf(prisma, A.users.HEAD.id);
    const catalog = await structures.listCatalog(bursarU);
    const st = await structures.createStructure(bursarU, {});
    await structures.saveLine(bursarU, st.id, null, { catalogItemId: catalog.find((i) => i.name === 'Tuition')!.id, amount: '300.00', currency: 'USD', levelIds: [A.levelId] });
    await structures.saveLine(bursarU, st.id, null, { catalogItemId: catalog.find((i) => i.name === 'Boarding fee')!.id, amount: '400.00', currency: 'USD', levelIds: [A.levelId], boarding: 'BOARDER' });
    await structures.submitStructure(bursarU, st.id);
    await structures.approveStructure(headU, st.id);
    await billing.runBilling(bursarU, {});
    expect((await prisma.finCharge.findMany({ where: { schoolId: A.schoolId, studentId: kid.d1! } })).map((c) => c.amountCents)).toEqual([30_000]);
    await fails(hs.allocateBed(bm, { studentId: kid.d1, bedId: bed.r1![2] }), 409, /day scholar/);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: kid.d1! } })).boarding).toBe('DAY');
    // Changing a status is a student-record change, which a boarding master has not been given.
    await fails(hs.allocateBed(bm, { studentId: kid.d1, bedId: bed.r1![2], changeToBoarder: true }), 403);
    const r = await hs.allocateBed(op, { studentId: kid.d1, bedId: bed.r1![2], changeToBoarder: true });
    expect(r.changedToBoarder).toBe(true);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: kid.d1! } })).boarding).toBe('BOARDER');
    const charges = await prisma.finCharge.findMany({ where: { schoolId: A.schoolId, studentId: kid.d1! } });
    const boarding = charges.find((c) => c.source === 'BOARDING_CHANGE')!;
    expect(boarding).toMatchObject({ amountCents: 40_000, currency: 'USD' });
    expect(charges.filter((c) => c.source === 'BOARDING_CHANGE')).toHaveLength(1);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'UPDATE_STUDENT', entityId: kid.d1 }, orderBy: { createdAt: 'desc' } });
    expect(log.before).toMatchObject({ boarding: 'DAY' });
    expect(log.after).toMatchObject({ boarding: 'BOARDER' });
  });

  it('the database itself refuses a bed for a day scholar, a wrong gender, or a bed that is not in use', async () => {
    const term = A.termId;
    const ins = (student: string, bedId: string) => `INSERT INTO "FacBedAllocation" ("id", "schoolId", "studentId", "bedId", "termId", "fromDate", "allocatedById") VALUES (gen_random_uuid()::text, '${A.schoolId}', '${student}', '${bedId}', '${term}', now(), '${op.id}')`;
    await expect(t.pg.query(ins(kid.d2!, bed.g![1]!))).rejects.toThrow(/Only a boarder can be given a bed/);
    await expect(t.pg.query(ins(kid.b3!, bed.g![1]!))).rejects.toThrow(/for girls/);
    await t.pg.query(`UPDATE "FacBed" SET "active" = false WHERE "id" = '${bed.r2![0]}'`);
    await expect(t.pg.query(ins(kid.b3!, bed.r2![0]!))).rejects.toThrow(/not in use/);
    await t.pg.query(`UPDATE "FacBed" SET "active" = true WHERE "id" = '${bed.r2![0]}'`);
    // One bed per learner and one learner per bed, also in the database.
    await expect(t.pg.query(ins(kid.b1!, bed.r2![1]!))).rejects.toThrow(/FacBedAllocation_student_open/);
  });

  it('a bed is released with a reason, and a learner who has left does not keep one', async () => {
    await fails(hs.vacateBed(bm, { studentId: kid.b2, reason: '' }), 422);
    await hs.vacateBed(bm, { studentId: kid.b2, reason: 'Moved to the other block' });
    expect((await hs.bedHistory(op, kid.b2!))[0]).toMatchObject({ to: expect.any(String), reason: 'Moved to the other block' });
    await fails(hs.vacateBed(bm, { studentId: kid.b2, reason: 'Again please' }), 404);
    await hs.allocateBed(bm, { studentId: kid.b2, bedId: bed.r1![0] });
    await prisma.student.update({ where: { id: kid.b2! }, data: { status: 'TRANSFERRED' } });
    const card = (await hs.listHostels(bm))[0]!;
    expect(card.filled).toBe(2); // b1 and d1; b2 left
    expect((await prisma.facBedAllocation.findFirstOrThrow({ where: { studentId: kid.b2!, toDate: { not: null } }, orderBy: { createdAt: 'desc' } })).reason).toBe('Left the school');
    await prisma.student.update({ where: { id: kid.b2! }, data: { status: 'ACTIVE' } });
  });
});

describe('allocating a whole intake', () => {
  it('shows the plan first, then fills the free beds with the boarders who have none', async () => {
    const plan = await hs.autoAllocate(bm, { hostelId: h.boys, keepFormsTogether: true });
    expect(plan.applied).toBe(false);
    expect(plan.candidates).toBe(3); // b2 (released), b3 and b4 have no bed
    expect(plan.placements.every((p) => p.room && p.bed)).toBe(true);
    expect(await prisma.facBedAllocation.count({ where: { schoolId: A.schoolId, toDate: null } })).toBe(3);
  });

  it('applies it, places what fits, and says who is left without a bed', async () => {
    const done = await hs.autoAllocate(bm, { hostelId: h.boys, keepFormsTogether: false, apply: true });
    expect(done.applied).toBe(true);
    expect(done.placements.length + done.unplaced.length).toBe(done.candidates);
    expect(await prisma.facBedAllocation.count({ where: { schoolId: A.schoolId, toDate: null } })).toBe(3 + done.placements.length);
    await fails(hs.autoAllocate(bm, { hostelId: h.boys, apply: true }), 409);
    await fails(hs.autoAllocate(bm, { hostelId: h.girls, apply: true }), 403);
    await fails(hs.autoAllocate(plain, { hostelId: h.boys }), 403);
  });
});

describe('the room list', () => {
  it('has room, bed, learner, class and the guardian\'s phone, for people who may see guardians', async () => {
    const list = await hs.roomList(bm, h.boys);
    const alpha = list.rows.find((r) => r.learner === 'Alpha Learner')!;
    expect(alpha).toMatchObject({ room: 'Room 1', bed: '2', className: 'Form 1 North' });
    expect(alpha.guardianPhone).toMatch(/^\+2637/);
    await fails(hs.roomList(plain, h.boys), 403);
    await fails(hs.roomList(bm, h.girls), 403);
  });
});

describe('the roll call', () => {
  const sheet = (hostelId: string, session: 'MORNING' | 'EVENING' | 'LIGHTS_OUT' = 'EVENING', date?: string) => hs.rollCallSheet(bm, { hostelId, session, date });
  const rows = async (session: 'MORNING' | 'EVENING' | 'LIGHTS_OUT' = 'EVENING') => Object.fromEntries((await sheet(h.boys!, session)).rows.map((r) => [r.name.split(' ')[0]!, r]));

  it('starts with everyone Present', async () => {
    const r = await rows();
    expect(Object.values(r).every((x) => x.status === 'PRESENT' && !x.locked)).toBe(true);
    expect(Object.keys(r)).toEqual(expect.arrayContaining(['Alpha', 'Dayo']));
  });

  it('fills in learners on exeat, in the sick bay or suspended, and locks them', async () => {
    const out = new Date(Date.now() - 3_600_000);
    await prisma.facExeat.create({ data: { schoolId: A.schoolId, studentId: kid.b1!, type: 'WEEKEND', outAt: out, dueBackAt: new Date(Date.now() + 86_400_000), reason: 'Family function', collectedBy: { kind: 'OTHER', name: 'Mr Collector', idNumber: '63-1234567X63', phone: '+263773000111', primaryConfirmedAt: new Date().toISOString(), primaryConfirmedBy: 'Mother', confirmMethod: 'PHONE' }, requestedById: bm.id, approvedById: bm.id, approvedAt: out, signedOutAt: out, signedOutById: bm.id, status: 'SIGNED_OUT' } });
    await prisma.facSickBayVisit.create({ data: { schoolId: A.schoolId, studentId: kid.d1!, visitedAt: out, complaint: 'FEVER', outcome: 'REST_IN_SICK_BAY', admittedAt: out, recordedById: matron.id } });
    const r = await rows();
    expect(r.Alpha).toMatchObject({ status: 'EXEAT', locked: true });
    expect(r.Dayo).toMatchObject({ status: 'SICK_BAY', locked: true });
    // The learner suspended from school is locked too.
    const third = Object.values(r).find((x) => !x.locked && x.name.startsWith('Bravo') === false)!;
    await prisma.student.update({ where: { id: third.studentId }, data: { status: 'SUSPENDED' } });
    expect(Object.values(await rows()).find((x) => x.studentId === third.studentId)).toMatchObject({ status: 'SUSPENDED', locked: true });
    await prisma.student.update({ where: { id: third.studentId }, data: { status: 'ACTIVE' } });
  });

  it('shows the same learner as On exeat in the class register', async () => {
    const locks = await scoped.getScopedDb(A.schoolId, op.id).$tx((tx) => attendance.lockedStudents(tx, A.schoolId, today(), [kid.b1!, kid.b3!]));
    expect(locks.get(kid.b1!)).toBe('EXEAT');
    expect(locks.has(kid.b3!)).toBe(false);
    // The day before the exeat started, and the day after the learner came back, they are not locked.
    const past = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    expect((await scoped.getScopedDb(A.schoolId, op.id).$tx((tx) => attendance.lockedStudents(tx, A.schoolId, past, [kid.b1!]))).has(kid.b1!)).toBe(false);
  });

  it('saves the exceptions; saving again replaces the roll call; a locked learner cannot be marked by hand', async () => {
    const date = today();
    const r1 = await hs.saveRollCall(bm, { hostelId: h.boys, date, session: 'EVENING', entries: [{ studentId: kid.b3, status: 'LATE', note: 'Study' }, { studentId: kid.b1, status: 'ABSENT' }] });
    expect(r1).toMatchObject({ outcome: 'created', late: 1, absent: 0 });
    const after = await rows();
    expect(after.Charlie).toMatchObject({ status: 'LATE', note: 'Study' });
    expect(after.Alpha).toMatchObject({ status: 'EXEAT' }); // forced to its lock, not Absent
    const r2 = await hs.saveRollCall(bm, { hostelId: h.boys, date, session: 'EVENING', entries: [{ studentId: kid.b3, status: 'ABSENT', note: 'Went home sick' }] });
    expect(r2).toMatchObject({ outcome: 'updated', absent: 1, late: 0 });
    expect(await prisma.facRollCall.count({ where: { schoolId: A.schoolId, hostelId: h.boys, date: new Date(`${date}T00:00:00Z`), session: 'EVENING' } })).toBe(1);
    const entry = await prisma.facRollCallEntry.findFirstOrThrow({ where: { studentId: kid.b1! } });
    expect(entry).toMatchObject({ status: 'EXEAT', locked: true });
  });

  it('refuses a future day, a session the school does not use, a stranger and the same learner twice', async () => {
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await fails(hs.saveRollCall(bm, { hostelId: h.boys, date: tomorrow, session: 'EVENING', entries: [] }), 422);
    await fails(hs.saveRollCall(bm, { hostelId: h.boys, date: today(), session: 'EVENING', entries: [{ studentId: kid.g1, status: 'ABSENT' }] }), 422, /does not sleep/);
    await fails(hs.saveRollCall(bm, { hostelId: h.boys, date: today(), session: 'EVENING', entries: [{ studentId: kid.b3, status: 'ABSENT' }, { studentId: kid.b3, status: 'LATE' }] }), 422);
    await settings.updateFacSettings(op, { rollCallSessions: ['EVENING', 'LIGHTS_OUT'] });
    await fails(hs.saveRollCall(bm, { hostelId: h.boys, date: today(), session: 'MORNING', entries: [] }), 409, /not one of this school/);
    await fails(hs.saveRollCall(bm, { hostelId: h.girls, date: today(), session: 'EVENING', entries: [] }), 403);
    await fails(hs.saveRollCall(plain, { hostelId: h.boys, date: today(), session: 'EVENING', entries: [] }), 403);
  });

  it('an unexplained Absent at lights out alerts the boarding master and the Deputy at once; an explained one does not', async () => {
    const date = today();
    const before = await prisma.notification.count({ where: { schoolId: A.schoolId, title: { contains: 'Not in bed at lights out' } } });
    const done = await hs.saveRollCall(bm, { hostelId: h.boys, date, session: 'LIGHTS_OUT', entries: [{ studentId: kid.b3, status: 'ABSENT' }, { studentId: kid.b4, status: 'ABSENT', note: 'At the clinic' }] });
    expect(done).toMatchObject({ absent: 2, alerted: 1 });
    const notes = await prisma.notification.findMany({ where: { schoolId: A.schoolId, title: { contains: 'Not in bed at lights out' } } });
    expect(notes.length - before).toBe(2);
    expect(notes.map((n) => n.userId).sort()).toEqual([bm.id, deputy.id].sort());
    expect(notes[0]!.title).toContain('Charlie');
    expect(notes[0]!.title).not.toContain('Delta');
    // Saving the same roll call again does not alert twice.
    const again = await hs.saveRollCall(bm, { hostelId: h.boys, date, session: 'LIGHTS_OUT', entries: [{ studentId: kid.b3, status: 'ABSENT' }, { studentId: kid.b4, status: 'ABSENT', note: 'At the clinic' }] });
    expect(again.alerted).toBe(0);
    expect(await prisma.notification.count({ where: { schoolId: A.schoolId, title: { contains: 'Not in bed at lights out' } } })).toBe(notes.length);
    // The evening roll call does not alert.
    await hs.saveRollCall(bm, { hostelId: h.boys, date, session: 'EVENING', entries: [{ studentId: kid.b4, status: 'ABSENT' }] });
    expect(await prisma.notification.count({ where: { schoolId: A.schoolId, title: { contains: 'Not in bed at lights out' } } })).toBe(notes.length);
  });

  it('works from the offline queue: the same roll call sent twice is one roll call, and one bad one does not stop the rest', async () => {
    const date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const good = { ref: 'a', hostelId: h.boys, date, session: 'EVENING', entries: [{ studentId: kid.b3, status: 'LATE' }], clientId: 'client-1' };
    const bad = { ref: 'b', hostelId: h.boys, date, session: 'LIGHTS_OUT', entries: [{ studentId: kid.g1, status: 'ABSENT' }], clientId: 'client-2' };
    const first = await hs.syncRollCalls(bm, { rollCalls: [good, bad] });
    expect(first.results[0]).toMatchObject({ ref: 'a', ok: true, outcome: 'created' });
    expect(first.results[1]).toMatchObject({ ref: 'b', ok: false, status: 422 });
    const second = await hs.syncRollCalls(bm, { rollCalls: [good] });
    expect(second.results[0]).toMatchObject({ ok: true, outcome: 'updated' });
    expect(await prisma.facRollCall.count({ where: { schoolId: A.schoolId, hostelId: h.boys, date: new Date(`${date}T00:00:00Z`) } })).toBe(1);
    // The database itself says a locked entry is only for a learner who is away.
    const rc = await prisma.facRollCall.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    await expect(t.pg.query(`INSERT INTO "FacRollCallEntry" ("id", "schoolId", "rollCallId", "studentId", "status", "locked") VALUES ('x1', '${A.schoolId}', '${rc.id}', '${kid.g1}', 'PRESENT', true)`)).rejects.toThrow(/FacRollCallEntry_locked/);
  });

  it('shows tonight\'s status for each hostel and session', async () => {
    const s = await hs.rollCallStatus(bm);
    expect(s).toHaveLength(1);
    expect(s[0]!.sessions.find((x) => x.session === 'LIGHTS_OUT')).toMatchObject({ taken: true, absent: 2 });
    expect(s[0]!.sessions.map((x) => x.session)).toEqual(['EVENING', 'LIGHTS_OUT']);
  });
});

describe('inspections', () => {
  let item: string;

  it('score a room out of 100 and leave damage waiting for the boarding master', async () => {
    const roomId = (await hs.getHostel(bm, h.boys)).rooms.find((r) => r.name === 'Room 1')!.id;
    const r = await hs.saveInspection(bm, { hostelId: h.boys, roomId, notes: 'Mostly tidy', items: [
      { item: 'CLEANLINESS', score: 4 }, { item: 'BEDS_MADE', score: 5 }, { item: 'LOCKERS', score: 3 },
      { item: 'DAMAGE', score: 2, note: 'Broken window pane', damage: { studentId: kid.b1, amountCents: 1500, currency: 'USD' } },
    ] });
    expect(r.score).toBe(70);
    const list = await hs.listInspections(bm);
    item = list[0]!.items.find((i) => i.damageStatus)!.id;
    expect(list[0]).toMatchObject({ room: 'Room 1', score: 70, notes: 'Mostly tidy' });
    expect(list[0]!.items.find((i) => i.id === item)).toMatchObject({ damageStatus: 'PENDING', learner: 'Alpha Learner' });
    expect(await prisma.finCharge.count({ where: { schoolId: A.schoolId, description: { contains: 'Damage' } } })).toBe(0);
    await fails(hs.saveInspection(bm, { hostelId: h.boys, roomId, items: [] }), 422);
    await fails(hs.saveInspection(bm, { hostelId: h.boys, roomId, items: [{ item: 'LOCKERS', score: 6 }] }), 422);
    await fails(hs.saveInspection(bm, { hostelId: h.girls, roomId, items: [{ item: 'LOCKERS', score: 3 }] }), 403);
    await fails(hs.saveInspection(plain, { hostelId: h.boys, roomId, items: [{ item: 'LOCKERS', score: 3 }] }), 403);
    await fails(hs.saveInspection(bm, { hostelId: h.boys, roomId, items: [{ item: 'LOCKERS', score: 3 }], photoKeys: ['pop:other:1'] }), 422);
  });

  it('become a charge to the learner only when approved, in Finance or on the hostel ledger', async () => {
    const out = await hs.decideDamage(bm, item, { decision: 'APPROVE' });
    expect(out).toEqual({ status: 'APPROVED', charged: 'FINANCE' });
    const row = await prisma.facInspectionItem.findUniqueOrThrow({ where: { id: item } });
    expect(row).toMatchObject({ damageStatus: 'APPROVED', damageApprovedById: bm.id });
    const c = await prisma.finCharge.findUniqueOrThrow({ where: { id: row.damageChargeId! } });
    expect(c).toMatchObject({ studentId: kid.b1, amountCents: 1500, currency: 'USD', source: 'FACILITIES' });
    expect(c.description).toMatch(/Damage in Room 1: DAMAGE \(Broken window pane\)/);
    await fails(hs.decideDamage(bm, item, { decision: 'APPROVE' }), 409);
    await fails(hs.decideDamage(plain, item, { decision: 'APPROVE' }), 403);
  });

  it('can be refused with a reason, and with Finance off the damage sits on the ledger', async () => {
    const roomId = (await hs.getHostel(bm, h.boys)).rooms[0]!.id;
    await hs.saveInspection(bm, { hostelId: h.boys, roomId, items: [{ item: 'DAMAGE', score: 3, damage: { studentId: kid.b3, amountCents: 500, currency: 'USD' } }] });
    const pending = (await hs.listInspections(bm)).flatMap((i) => i.items).find((i) => i.damageStatus === 'PENDING')!;
    await fails(hs.decideDamage(bm, pending.id, { decision: 'REJECT' }), 422);
    expect(await hs.decideDamage(bm, pending.id, { decision: 'REJECT', reason: 'It was already broken' })).toEqual({ status: 'REJECTED' });
    expect((await hs.listInspections(bm)).flatMap((i) => i.items).find((i) => i.id === pending.id)!.damageStatus).toBe('REJECTED');

    const hB = (await hs.saveHostel(opB, { name: 'B House', gender: 'M' })).id;
    const rB = (await hs.saveRoom(opB, { hostelId: hB, name: 'R' })).id;
    await hs.addBeds(opB, { roomId: rB, count: 1 });
    await hs.saveInspection(opB, { hostelId: hB, roomId: rB, items: [{ item: 'DAMAGE', score: 1, damage: { studentId: kid.other, amountCents: 900, currency: 'USD' } }] });
    const itemB = (await hs.listInspections(opB))[0]!.items[0]!;
    expect(await hs.decideDamage(opB, itemB.id, { decision: 'APPROVE' })).toEqual({ status: 'APPROVED', charged: 'LEDGER' });
    expect(await prisma.facLedgerEntry.findFirstOrThrow({ where: { schoolId: B.schoolId, part: 'HOSTEL' } })).toMatchObject({ amountCents: 900, status: 'OPEN', studentId: kid.other });
  });
});

describe('the dashboard', () => {
  it('shows beds filled against capacity, tonight\'s roll call, learners away and overdue returns', async () => {
    await prisma.facExeat.update({ where: { id: (await prisma.facExeat.findFirstOrThrow({ where: { schoolId: A.schoolId } })).id }, data: { dueBackAt: new Date(Date.now() - 3_600_000) } });
    const d = await hs.hostelDashboard(bm);
    expect(d.hostels.map((x) => x.name)).toEqual(['Moyo House']);
    expect(d.beds.total).toBeGreaterThan(0);
    expect(d.beds.filled).toBeGreaterThan(0);
    expect(d).toMatchObject({ onExeat: 1, inSickBay: 1, overdueReturns: 1 });
    expect(d.rollCalls).toHaveLength(1);
    const all = await hs.hostelDashboard(op);
    expect(all.hostels).toHaveLength(2);
  });
});

describe('one school never sees another', () => {
  it('B cannot see, allocate into or call the roll of A\'s hostel', async () => {
    expect((await hs.listHostels(opB)).map((x) => x.name)).toEqual(['B House']);
    await fails(hs.getHostel(opB, h.boys!), 404);
    await fails(hs.allocateBed(opB, { studentId: kid.other, bedId: bed.r1![2] }), 404);
    await fails(hs.saveRoom(opB, { hostelId: h.boys, name: 'Hack' }), 404);
    await fails(hs.saveRollCall(opB, { hostelId: h.boys, date: today(), session: 'EVENING', entries: [] }), 404);
    await fails(hs.rollCallSheet(opB, { hostelId: h.boys, session: 'EVENING' }), 404);
    await fails(hs.bedHistory(opB, kid.b1!), 404);
    await fails(hs.autoAllocate(opB, { hostelId: h.boys }), 404);
    await fails(hs.decideDamage(opB, (await prisma.facInspectionItem.findFirstOrThrow({ where: { schoolId: A.schoolId } })).id, { decision: 'REJECT', reason: 'Not yours' }), 404);
  });
});

describe('a part switched off', () => {
  it('refuses every hostel call for that school', async () => {
    await prisma.schoolModule.create({ data: { schoolId: B.schoolId, module: 'facilities.hostel', enabled: false } });
    const off = await actorOf(prisma, B.operator!.id);
    await fails(hs.listHostels(off), 403);
    await fails(hs.saveHostel(off, { name: 'X', gender: 'M' }), 403);
    await fails(hs.hostelDashboard(off), 403);
    expect((await call('facilities/hostel', 'GET', { as: B.operator! })).status).toBe(403);
    await prisma.schoolModule.deleteMany({ where: { schoolId: B.schoolId, module: 'facilities.hostel' } });
  });
});

describe('the routes', () => {
  const routes: [string, 'GET' | 'POST', Record<string, string>?][] = [
    ['hostel', 'GET'], ['hostel', 'POST'], ['hostel/[id]', 'GET', { id: 'x' }], ['hostel/[id]/room-list', 'GET', { id: 'x' }], ['hostel/rooms', 'POST'], ['hostel/beds', 'POST'], ['hostel/allocate', 'POST'],
    ['hostel/vacate', 'POST'], ['hostel/auto-allocate', 'POST'], ['hostel/bed-history', 'GET'], ['hostel/rollcall', 'GET'], ['hostel/rollcall', 'POST'], ['hostel/rollcall/sync', 'POST'],
    ['hostel/rollcall/status', 'GET'], ['hostel/inspections', 'GET'], ['hostel/inspections', 'POST'], ['hostel/inspections/items/[id]/decide', 'POST', { id: 'x' }], ['hostel/dashboard', 'GET'],
  ];
  for (const [file, method, params] of routes) {
    it(`${method} /api/facilities/${file}: 401 without a session, 403 for a plain member of staff`, async () => {
      const body = method === 'GET' ? undefined : {};
      expect((await call(`facilities/${file}`, method, { as: null, params, body })).status).toBe(401);
      const u = await userWithRoles(prisma, A, ['TEACHER'], 'route');
      expect((await call(`facilities/${file}`, method, { as: u, params, body })).status).toBe(403);
    });
  }

  it('work end to end for the boarding master on a phone', async () => {
    const as = { id: bm.id, email: 'bm@x.test', schoolId: A.schoolId, role: 'TEACHER' as const, fullName: 'bm' };
    const list = await call('facilities/hostel', 'GET', { as });
    expect(list.status).toBe(200);
    expect(list.json.data.map((x: { name: string }) => x.name)).toEqual(['Moyo House']);
    const sheet = await call('facilities/hostel/rollcall', 'GET', { as, query: `?hostelId=${h.boys}&session=EVENING` });
    expect(sheet.status).toBe(200);
    expect(sheet.json.data.rows.length).toBeGreaterThan(0);
    expect((await call('facilities/hostel/rollcall', 'POST', { as, body: { hostelId: h.boys, date: today(), session: 'EVENING', entries: [{ studentId: kid.b3, status: 'LATE' }] } })).status).toBe(201);
    expect((await call('facilities/hostel/rollcall', 'POST', { as, body: { hostelId: h.boys } })).status).toBe(422);
    expect((await call('facilities/hostel/rollcall/sync', 'POST', { as, body: { rollCalls: [] } })).status).toBe(422);
    expect((await call('facilities/hostel/rooms', 'POST', { as, body: { hostelId: h.girls, name: 'Hack' } })).status).toBe(403);
    expect((await call('facilities/hostel/[id]', 'GET', { as, params: { id: h.girls! } })).status).toBe(403);
  });

  it('school B\'s operator gets nothing of school A through the routes', async () => {
    expect((await call('facilities/hostel/[id]', 'GET', { as: B.operator!, params: { id: h.boys! } })).status).toBe(404);
    expect((await call('facilities/hostel/allocate', 'POST', { as: B.operator!, body: { studentId: kid.b3, bedId: bed.r1![2] } })).status).toBe(404);
    expect(JSON.stringify((await call('facilities/hostel', 'GET', { as: B.operator! })).json)).not.toContain('Moyo House');
  });
});

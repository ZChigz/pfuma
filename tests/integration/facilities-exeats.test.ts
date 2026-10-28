// @vitest-environment node
// Exeats against a real PostgreSQL: boarders only, the boarding master approves ordinary exeats and the Head long and emergency ones (never
// the person who recorded it), a collector who is not an authorised guardian is refused unless the primary guardian's confirmation is
// recorded, the guardian is told by SMS, a learner out shows as On exeat, a late return alerts the boarding master and then the Head, and the
// visitor log lets in only guardians on record or visitors the boarding master approves.
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
let ex: typeof import('@/lib/facilities/exeats');
let hs: typeof import('@/lib/facilities/hostel');
let scoped: typeof import('@/lib/scoped-db');
let A: SeededSchool; let B: SeededSchool;
let op: Actor; let bm: Actor; let head: Actor; let plain: Actor;
const kid: Record<string, string> = {};
const g: Record<string, string> = {};
const DAY = 86_400_000;
const soon = (h = 1) => new Date(Date.now() + h * 3_600_000).toISOString();
const days = (d: number) => new Date(Date.now() + d * DAY).toISOString();

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  [ex, hs, scoped] = await Promise.all([import('@/lib/facilities/exeats'), import('@/lib/facilities/hostel'), import('@/lib/scoped-db')]);
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  const bmU = await userWithRoles(prisma, A, ['BOARDING_MASTER'], 'bm');
  const headU = await userWithRoles(prisma, A, ['HEAD'], 'head');
  const plainU = await userWithRoles(prisma, A, ['TEACHER'], 'plain');
  const mk = async (key: string, boarding: 'DAY' | 'BOARDER', name: string) => { kid[key] = (await addStudent(prisma, A, { firstName: name, surname: 'Learner', gender: 'M', boarding })).id; };
  for (const [k, n] of [['b1', 'Alpha'], ['b2', 'Bravo'], ['b3', 'Charlie'], ['b4', 'Delta'], ['b5', 'Echo']] as const) await mk(k, 'BOARDER', n);
  await mk('d1', 'DAY', 'Dayo');
  kid.other = (await addStudent(prisma, B, { firstName: 'Other', surname: 'School', gender: 'M', boarding: 'BOARDER' })).id;
  [op, bm, head, plain] = await Promise.all([actorOf(prisma, A.operator!.id), actorOf(prisma, bmU.id), actorOf(prisma, headU.id), actorOf(prisma, plainU.id)]);
  // A hostel with the boarding master and beds for the boarders.
  const hostel = (await hs.saveHostel(op, { name: 'Moyo House', gender: 'M', boardingMasterId: bm.id, capacity: 6 })).id;
  const room = (await hs.saveRoom(op, { hostelId: hostel, name: 'Room 1', capacity: 6 })).id;
  await hs.addBeds(op, { roomId: room, count: 6 });
  g.hostel = hostel;
  const beds = (await hs.getHostel(op, hostel)).rooms[0]!.beds.map((b) => b.id);
  for (const [i, k] of ['b1', 'b2', 'b3', 'b4', 'b5'].entries()) await hs.allocateBed(op, { studentId: kid[k]!, bedId: beds[i]! });
  // Guardians: the primary one may collect, an uncle is on record but may not.
  const primary = await prisma.studentGuardian.findFirstOrThrow({ where: { studentId: kid.b1 }, select: { guardianId: true } });
  g.mother = primary.guardianId;
  await prisma.studentGuardian.update({ where: { studentId_guardianId: { studentId: kid.b1!, guardianId: g.mother } }, data: { canCollect: true, custodyNote: 'Only collect with mother' } });
  const uncle = await prisma.guardian.create({ data: { schoolId: A.schoolId, fullName: 'Uncle Tendai', phone: '+263772000111' } });
  g.uncle = uncle.id;
  await prisma.studentGuardian.create({ data: { studentId: kid.b1!, guardianId: uncle.id, relationship: 'UNCLE', canCollect: false } });
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('recording and approving', () => {
  it('is for boarders only, with a reason, and not twice for the same dates', async () => {
    await fails(ex.requestExeat(bm, { studentId: kid.d1, type: 'WEEKEND', outAt: soon(), dueBackAt: days(2), reason: 'Family' }), 409, /day scholar/);
    await fails(ex.requestExeat(bm, { studentId: kid.b2, type: 'WEEKEND', outAt: soon(), dueBackAt: days(2), reason: '' }), 422);
    await fails(ex.requestExeat(bm, { studentId: kid.b2, type: 'WEEKEND', outAt: days(2), dueBackAt: days(1), reason: 'Backwards' }), 422);
    await fails(ex.requestExeat(bm, { studentId: kid.b2, type: 'WEEKEND', outAt: soon(), dueBackAt: days(8), reason: 'Too long for a weekend' }), 422, /long exeat/);
    await fails(ex.requestExeat(plain, { studentId: kid.b2, type: 'WEEKEND', outAt: soon(), dueBackAt: days(2), reason: 'Not allowed' }), 403);
    await fails(ex.requestExeat(bm, { studentId: kid.other, type: 'WEEKEND', outAt: soon(), dueBackAt: days(2), reason: 'Other school' }), 404);
    const r = await ex.requestExeat(bm, { studentId: kid.b2, type: 'WEEKEND', outAt: soon(), dueBackAt: days(2), reason: 'Cousin\'s wedding' });
    expect(r.status).toBe('REQUESTED');
    await fails(ex.requestExeat(bm, { studentId: kid.b2, type: 'MEDICAL', outAt: days(1), dueBackAt: days(3), reason: 'Clinic' }), 409, /already has an exeat/);
    g.weekend = r.id;
  });

  it('is approved by the boarding master for a weekend, by the Head for a long exeat, and never by the person who recorded it', async () => {
    expect((await ex.decideExeat(bm, g.weekend!, { decision: 'APPROVE' })).status).toBe('APPROVED');
    await fails(ex.decideExeat(bm, g.weekend!, { decision: 'REJECT', reason: 'Too late' }), 409, /already decided/);
    const long = await ex.requestExeat(bm, { studentId: kid.b3, type: 'LONG', outAt: soon(), dueBackAt: days(10), reason: 'Mid-term break' });
    expect(long.needsHead).toBe(true);
    await fails(ex.decideExeat(bm, long.id, { decision: 'APPROVE' }), 403);
    // The owner holds every key, so only rule 7 stops an owner approving their own long exeat.
    const own = await ex.requestExeat(op, { studentId: kid.b4, type: 'EMERGENCY', outAt: soon(), dueBackAt: days(2), reason: 'Bereavement' });
    await fails(ex.decideExeat(op, own.id, { decision: 'APPROVE' }), 403);
    await fails(ex.decideExeat(head, long.id, { decision: 'REJECT' }), 422);
    expect((await ex.decideExeat(head, long.id, { decision: 'APPROVE' })).status).toBe('APPROVED');
    expect((await ex.decideExeat(head, own.id, { decision: 'REJECT', reason: 'Parent not reached' })).status).toBe('REJECTED');
    const note = await prisma.notification.findFirst({ where: { schoolId: A.schoolId, userId: head.id, title: { contains: 'exeat to approve' } } });
    expect(note).not.toBeNull();
    const audits = await prisma.auditLog.count({ where: { schoolId: A.schoolId, entityType: 'FacExeat', action: { in: ['FAC_EXEAT_REQUEST', 'FAC_EXEAT_APPROVE', 'FAC_EXEAT_REJECT'] } } });
    expect(audits).toBeGreaterThanOrEqual(5);
    g.long = long.id;
  });
});

describe('the gate', () => {
  it('shows the collectors, the custody note and the exeat', async () => {
    const card = await ex.gateLookup(bm, (await prisma.student.findUniqueOrThrow({ where: { id: kid.b1 } })).admissionNumber);
    expect(card.collectors.map((c) => c.name)).toHaveLength(1);
    expect(card.custodyNotes[0]?.note).toBe('Only collect with mother');
    expect(card.exeat).toBeNull();
    await fails(ex.gateLookup(bm, 'NOBODY-HAS-THIS'), 404);
    await fails(ex.gateLookup(bm, (await prisma.student.findUniqueOrThrow({ where: { id: kid.other } })).admissionNumber), 404);
  });

  it('refuses a collector who is not an authorised guardian unless the primary guardian\'s confirmation is recorded', async () => {
    const x = await ex.requestExeat(bm, { studentId: kid.b1, type: 'WEEKEND', outAt: soon(), dueBackAt: days(2), reason: 'Home for the weekend', approveNow: true });
    expect(x.status).toBe('APPROVED');
    await fails(ex.signOut(bm, { exeatId: x.id }), 422, /who is collecting/i);
    await fails(ex.signOut(bm, { exeatId: x.id, collector: { kind: 'GUARDIAN', guardianId: g.uncle } }), 409, /not marked as allowed to collect/);
    // Another adult without the primary guardian's confirmation fails validation.
    await fails(ex.signOut(bm, { exeatId: x.id, collector: { kind: 'OTHER', name: 'Mr Neighbour', idNumber: '63-1234567X63', phone: '+263773000222' } }), 422);
    expect((await prisma.facExeat.findUniqueOrThrow({ where: { id: x.id } })).status).toBe('APPROVED');
    // The database refuses it too, whatever the code does.
    await expect(t.pg.query(`UPDATE "FacExeat" SET "status" = 'SIGNED_OUT', "signedOutAt" = now(), "signedOutById" = '${bm.id}', "collectedBy" = '{"kind":"OTHER","name":"No confirmation"}' WHERE "id" = '${x.id}'`)).rejects.toThrow(/primary guardian's confirmation/);
    const out = await ex.signOut(bm, { exeatId: x.id, collector: { kind: 'OTHER', name: 'Mr Neighbour', idNumber: '63-1234567X63', phone: '+263773000222', confirmedBy: 'Mrs Moyo (mother)', confirmMethod: 'PHONE' } });
    expect(out.collector).toBe('Mr Neighbour');
    expect(out.smsQueued).toBe(1);
    const sms = await prisma.messageOutbox.findFirstOrThrow({ where: { schoolId: A.schoolId, studentId: kid.b1 } });
    expect(sms.body).toContain('Mr Neighbour');
    const saved = (await prisma.facExeat.findUniqueOrThrow({ where: { id: x.id } })).collectedBy as Record<string, unknown>;
    expect(saved).toMatchObject({ kind: 'OTHER', primaryConfirmedBy: 'Mrs Moyo (mother)', confirmMethod: 'PHONE' });
    expect(saved.primaryConfirmedAt).toBeTruthy();
    await fails(ex.signOut(bm, { exeatId: x.id }), 409, /already signed out/);
    g.out = x.id;
  });

  it('lets an authorised guardian collect without a further confirmation, and one learner is out only once', async () => {
    await fails(ex.signOut(plain, { exeatId: g.weekend }), 403);
    const out = await ex.signOut(bm, { exeatId: g.weekend!, collector: { kind: 'GUARDIAN', guardianId: (await prisma.studentGuardian.findFirstOrThrow({ where: { studentId: kid.b2 } })).guardianId } }).catch((e: Error) => e);
    // The guardian of b2 is not marked as able to collect, so this is refused until the box is ticked on the profile.
    expect(out).toBeInstanceOf(Error);
    await prisma.studentGuardian.updateMany({ where: { studentId: kid.b2 }, data: { canCollect: true } });
    const ok = await ex.signOut(bm, { exeatId: g.weekend!, collector: { kind: 'GUARDIAN', guardianId: (await prisma.studentGuardian.findFirstOrThrow({ where: { studentId: kid.b2 } })).guardianId } });
    expect(ok.smsQueued).toBe(1);
    // An exeat that has not been approved cannot be signed out.
    const waiting = await ex.requestExeat(bm, { studentId: kid.b5, type: 'LONG', outAt: soon(), dueBackAt: days(9), reason: 'Mid-term' });
    await fails(ex.signOut(bm, { exeatId: waiting.id }), 409, /not been approved/);
  });

  it('shows a learner who is out as On exeat in the roll call and the class register', async () => {
    const sheet = await hs.rollCallSheet(bm, { hostelId: g.hostel, session: 'EVENING' });
    expect(sheet.rows.find((r) => r.studentId === kid.b1)).toMatchObject({ status: 'EXEAT', locked: true });
    const today = new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);
    const attendance = await import('@/lib/academics/attendance');
    const locks = await scoped.getScopedDb(A.schoolId, op.id).$tx((tx) => attendance.lockedStudents(tx, A.schoolId, today, [kid.b1!, kid.b5!]));
    expect(locks.get(kid.b1!)).toBe('EXEAT');
    expect(locks.get(kid.b5!)).toBeUndefined();
  });
});

describe('late returns', () => {
  it('alerts the boarding master when the due time passes, and the Head with the guardian\'s phone two hours later, once each', async () => {
    const run = () => scoped.getScopedDb(A.schoolId, op.id).$tx((tx) => ex.exeatAlerts(tx, A.schoolId));
    expect(await run()).toEqual({ boardingMaster: 0, head: 0 });
    await prisma.facExeat.update({ where: { id: g.out }, data: { dueBackAt: new Date(Date.now() - 30 * 60_000), outAt: new Date(Date.now() - DAY) } });
    expect(await run()).toEqual({ boardingMaster: 1, head: 0 });
    expect(await run()).toEqual({ boardingMaster: 0, head: 0 });
    expect(await prisma.notification.count({ where: { schoolId: A.schoolId, userId: bm.id, title: { contains: 'Not back from exeat' } } })).toBe(1);
    expect(await prisma.notification.count({ where: { schoolId: A.schoolId, userId: head.id, title: { contains: 'Still not back' } } })).toBe(0);
    await prisma.facExeat.update({ where: { id: g.out }, data: { dueBackAt: new Date(Date.now() - 3 * 3_600_000) } });
    expect(await run()).toEqual({ boardingMaster: 0, head: 1 });
    const n = await prisma.notification.findFirstOrThrow({ where: { schoolId: A.schoolId, userId: head.id, title: { contains: 'Still not back' } } });
    expect(n.body).toMatch(/Guardian's phone: \+?\d+/);
    const list = await ex.listExeats(bm, { status: 'SIGNED_OUT' });
    expect(list.find((r) => r.id === g.out)!.overdueMinutes).toBeGreaterThan(170);
  });

  it('signs the learner back in, telling the guardian, and the exeat is closed', async () => {
    const back = await ex.signIn(bm, { exeatId: g.out });
    expect(back.lateMinutes).toBeGreaterThan(170);
    expect(back.smsQueued).toBe(1);
    await fails(ex.signIn(bm, { exeatId: g.out }), 409, /already back/);
    expect((await prisma.facExeat.findUniqueOrThrow({ where: { id: g.out } })).status).toBe('RETURNED');
  });
});

describe('a general exeat weekend and visitors', () => {
  it('makes a bulk list from a Calendar event for the boarders who are free', async () => {
    const start = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 6 * DAY).toISOString().slice(0, 10);
    const ev = await prisma.calendarEvent.create({ data: { schoolId: A.schoolId, title: 'General exeat weekend', kind: 'OTHER', startDate: new Date(start), endDate: new Date(end), createdById: op.id } });
    const preview = await ex.bulkExeats(bm, { hostelId: g.hostel, calendarEventId: ev.id });
    expect(preview.applied).toBe(false);
    expect(preview.learners.length).toBeGreaterThanOrEqual(3);
    const done = await ex.bulkExeats(bm, { hostelId: g.hostel, calendarEventId: ev.id, apply: true });
    expect(done.applied).toBe(true);
    const made = await prisma.facExeat.findMany({ where: { schoolId: A.schoolId, calendarEventId: ev.id } });
    expect(made.length).toBe(done.learners.length);
    expect(made.every((m) => m.status === 'APPROVED' && (m.collectedBy as { kind: string }).kind === 'PENDING')).toBe(true);
    // A second run skips everyone, and nobody can be signed out until the collector is named.
    await fails(ex.bulkExeats(bm, { hostelId: g.hostel, calendarEventId: ev.id, apply: true }), 409);
    await fails(ex.bulkExeats(bm, { hostelId: 'not-in-this-school', calendarEventId: ev.id }), 404);
    await fails(ex.signOut(bm, { exeatId: made[0]!.id }), 409);
  });

  it('lets in a guardian on record and a visitor the boarding master approves, and nobody else', async () => {
    const today = new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);
    await prisma.calendarEvent.create({ data: { schoolId: A.schoolId, title: 'Visiting day', kind: 'VISITING_DAY', startDate: new Date(today), endDate: new Date(today), createdById: op.id } });
    expect((await ex.visitingDays(bm))[0]).toMatchObject({ title: 'Visiting day', today: true });
    const v = await ex.logVisitor(bm, { studentId: kid.b1, visitorName: 'Mrs Moyo', guardianId: g.mother });
    expect(v.visitingDay).toBe(true);
    await fails(ex.logVisitor(bm, { studentId: kid.b1, visitorName: 'Mrs Moyo', guardianId: 'not-a-guardian' }), 404);
    await fails(ex.logVisitor(bm, { studentId: kid.d1, visitorName: 'Dayo\'s Mum' }), 409);
    await fails(ex.logVisitor(plain, { studentId: kid.b1, visitorName: 'Anyone' }), 403);
    expect((await ex.logVisitor(bm, { studentId: kid.b1, visitorName: 'Family friend' })).id).toBeTruthy();
    await ex.visitorOut(bm, v.id);
    await fails(ex.visitorOut(bm, v.id), 409);
    const log = await ex.listVisitors(bm);
    expect(log.map((r) => r.visitor).sort()).toEqual(['Family friend', 'Mrs Moyo']);
    expect((await prisma.facVisitorLog.findFirstOrThrow({ where: { visitorName: 'Family friend' } })).approvedById).toBe(bm.id);
  });
});

describe('another school', () => {
  it('cannot see or touch this school\'s exeats', async () => {
    const opB = await actorOf(prisma, B.operator!.id);
    expect(await ex.listExeats(opB)).toEqual([]);
    await fails(ex.decideExeat(opB, g.long!, { decision: 'APPROVE' }), 404);
    await fails(ex.signIn(opB, { exeatId: g.out }), 404);
    await fails(ex.cancelExeat(opB, g.long!, { reason: 'Not yours' }), 404);
    await fails(ex.requestExeat(opB, { studentId: kid.b1, type: 'WEEKEND', outAt: soon(), dueBackAt: days(2), reason: 'Not mine' }), 404);
  });
});

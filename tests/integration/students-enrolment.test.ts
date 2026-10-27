// @vitest-environment node
// Moving students between classes (with the approval rule), houses, and the one-enrollment-per-term rule.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { addClass, addStudent, dayOffset } from '../helpers/students';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let C: SeededSchool; // a term that has not started yet
let prisma: typeof import('@/lib/prisma').prisma;
let east: string;
let west: string;

const move = (as: { id: string } | null, move: Record<string, unknown>, dryRun = false) =>
  call('students/move', 'POST', { as: as as never, body: { move, dryRun } });
const enrollmentsOf = (studentId: string, termId: string) => prisma.enrollment.findMany({ where: { studentId, termId } });

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  C = await seedSchool(prisma, 'School C', { operator: true });
  // Keep the open terms around "today" so the dates in these tests stay valid whenever they run.
  for (const S of [A, B]) await prisma.academicTerm.update({ where: { id: S.termId }, data: { startDate: new Date(`${dayOffset(-30)}T00:00:00Z`), endDate: new Date(`${dayOffset(60)}T00:00:00Z`) } });
  await prisma.academicTerm.update({ where: { id: C.termId }, data: { startDate: new Date(`${dayOffset(7)}T00:00:00Z`), endDate: new Date(`${dayOffset(90)}T00:00:00Z`) } });
  east = (await addClass(prisma, A, 'Form 2 East')).id;
  west = (await addClass(prisma, A, 'Form 2 West')).id;
  await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.profiles.view');
  await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.enrolment.manage', 'CLASS');
  await grantPermission(prisma, C.schoolId, 'TEACHER', 'students.profiles.view');
  await grantPermission(prisma, C.schoolId, 'TEACHER', 'students.enrolment.manage', 'CLASS');
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('who may move students', () => {
  it('needs students.enrolment.manage', async () => {
    const s = await addStudent(prisma, A);
    expect((await move(A.users.BURSAR, { studentIds: [s.id], toClassId: east, reason: 'PARENT_REQUEST' })).status).toBe(403);
    expect((await move(null, { studentIds: [s.id], toClassId: east, reason: 'PARENT_REQUEST' })).status).toBe(401);
  });

  it('only reaches the students the user teaches', async () => {
    const elsewhere = await addStudent(prisma, A, { classId: west });
    const r = await move(A.users.TEACHER, { studentIds: [elsewhere.id], toClassId: east, reason: 'PARENT_REQUEST' });
    expect(r.status).toBe(404);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: elsewhere.id } })).currentClassId).toBe(west);
  });

  it("never touches another school's students or classes", async () => {
    const theirs = await addStudent(prisma, B);
    const mine = await addStudent(prisma, A);
    expect((await move(A.operator!, { studentIds: [theirs.id], toClassId: east, reason: 'PARENT_REQUEST' })).status).toBe(404);
    expect((await move(A.operator!, { studentIds: [mine.id], toClassId: B.classId, reason: 'PARENT_REQUEST' })).status).toBe(404);
  });
});

describe('after the term has started', () => {
  it('lets an approver move students at once, records who approved, and keeps one enrollment per term', async () => {
    const a = await addStudent(prisma, A);
    const b = await addStudent(prisma, A);
    const r = await move(A.operator!, { studentIds: [a.id, b.id], toClassId: east, reason: 'SUBJECT_COMBINATION' });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ mode: 'MID_TERM', appliesNow: true, applied: 2, pending: 0, className: 'Form 2 East' });
    for (const s of [a, b]) {
      const rows = await enrollmentsOf(s.id, A.termId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ classId: east, status: 'ACTIVE' });
      expect((await prisma.student.findUniqueOrThrow({ where: { id: s.id } })).currentClassId).toBe(east);
      const m = await prisma.classMove.findFirstOrThrow({ where: { studentId: s.id } });
      expect(m).toMatchObject({ status: 'APPROVED', approvedById: A.operator!.id, requestedById: A.operator!.id, fromClassId: A.classId, toClassId: east, reason: 'SUBJECT_COMBINATION' });
    }
    const audit = await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: 'TRANSFER_CLASS', entityId: a.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.before).toMatchObject({ classId: A.classId });
    expect(audit[0]!.after).toMatchObject({ classId: east });
  });

  it('keeps a request from someone who cannot approve waiting until an approver decides', async () => {
    const s = await addStudent(prisma, A);
    const r = await move(A.users.TEACHER, { studentIds: [s.id], toClassId: east, reason: 'PARENT_REQUEST' });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ appliesNow: false, applied: 0, pending: 1 });
    expect((await enrollmentsOf(s.id, A.termId))[0]!.classId).toBe(A.classId); // nothing changed yet
    expect((await prisma.student.findUniqueOrThrow({ where: { id: s.id } })).currentClassId).toBe(A.classId);
    const pending = await prisma.classMove.findFirstOrThrow({ where: { studentId: s.id } });
    expect(pending).toMatchObject({ status: 'PENDING', approvedById: null, requestedById: A.users.TEACHER.id });
    expect(await prisma.notification.count({ where: { schoolId: A.schoolId, userId: A.operator!.id, type: 'CLASS_MOVE_WAITING' } })).toBeGreaterThan(0);
    expect((await prisma.notification.count({ where: { userId: A.users.TEACHER.id, type: 'CLASS_MOVE_WAITING' } }))).toBe(0);

    // a second request for the same student must wait for the first
    expect((await move(A.users.TEACHER, { studentIds: [s.id], toClassId: west, reason: 'PARENT_REQUEST' })).status).toBe(409);

    // the requester cannot approve their own request
    const own = await call('students/move/[id]', 'POST', { as: A.users.TEACHER, params: { id: pending.id }, body: { decision: 'APPROVE' } });
    expect(own.status).toBe(403);
    expect((await prisma.classMove.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('PENDING');

    const list = await call('students/move', 'GET', { as: A.operator! });
    expect(list.json.data.moves.map((m: { id: string }) => m.id)).toContain(pending.id);

    const ok = await call('students/move/[id]', 'POST', { as: A.operator!, params: { id: pending.id }, body: { decision: 'APPROVE' } });
    expect(ok.status).toBe(200);
    expect((await enrollmentsOf(s.id, A.termId))[0]!.classId).toBe(east);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: s.id } })).currentClassId).toBe(east);
    expect(await prisma.classMove.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: 'APPROVED', approvedById: A.operator!.id });
    expect(await prisma.notification.count({ where: { userId: A.users.TEACHER.id, type: 'CLASS_MOVE_DECIDED' } })).toBeGreaterThan(0);
    expect((await call('students/move/[id]', 'POST', { as: A.operator!, params: { id: pending.id }, body: { decision: 'APPROVE' } })).status).toBe(409); // already decided
  });

  it('lets an approver decline a request, leaving the student where they were', async () => {
    const s = await addStudent(prisma, A);
    await move(A.users.TEACHER, { studentIds: [s.id], toClassId: east, reason: 'BEHAVIOUR' });
    const pending = await prisma.classMove.findFirstOrThrow({ where: { studentId: s.id, status: 'PENDING' } });
    const r = await call('students/move/[id]', 'POST', { as: A.users.HEAD, params: { id: pending.id }, body: { decision: 'REJECT', note: 'Not now' } });
    expect(r.status).toBe(200);
    expect((await enrollmentsOf(s.id, A.termId))[0]!.classId).toBe(A.classId);
    expect(await prisma.classMove.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: 'REJECTED', approvedById: A.users.HEAD.id });
    // and the student can be asked about again
    expect((await move(A.users.TEACHER, { studentIds: [s.id], toClassId: east, reason: 'BEHAVIOUR' })).status).toBe(200);
  });

  it('warns when the class is full, shows the new size, and goes ahead only when confirmed', async () => {
    const tiny = await addClass(prisma, A, 'Form 3 Tiny', { capacity: 1, order: 3 });
    const first = await addStudent(prisma, A, { classId: tiny.id });
    const second = await addStudent(prisma, A);
    expect(first.id).toBeTruthy();
    const dry = await move(A.operator!, { studentIds: [second.id], toClassId: tiny.id, reason: 'BALANCING_CLASS_SIZES' }, true);
    expect(dry.status).toBe(200);
    expect(dry.json.data).toMatchObject({ currentSize: 1, newSize: 2, capacity: 1, applied: 0 });
    expect(dry.json.data.warnings[0].code).toBe('CLASS_FULL');
    expect((await enrollmentsOf(second.id, A.termId))[0]!.classId).toBe(A.classId); // a preview changes nothing

    const refused = await move(A.operator!, { studentIds: [second.id], toClassId: tiny.id, reason: 'BALANCING_CLASS_SIZES' });
    expect(refused.status).toBe(409);
    expect(refused.json.message).toContain('capacity is 1');
    const ok = await move(A.operator!, { studentIds: [second.id], toClassId: tiny.id, reason: 'BALANCING_CLASS_SIZES', acknowledgeFull: true });
    expect(ok.status).toBe(200);
    expect(ok.json.data.newSize).toBe(2);
  });

  it('moves a whole batch or nothing', async () => {
    const good = await addStudent(prisma, A);
    const gone = await addStudent(prisma, A, { status: 'TRANSFERRED' });
    const r = await move(A.operator!, { studentIds: [good.id, gone.id], toClassId: east, reason: 'OTHER', reasonNote: 'Testing' });
    expect(r.status).toBe(409);
    expect((await enrollmentsOf(good.id, A.termId))[0]!.classId).toBe(A.classId);
    expect(await prisma.classMove.count({ where: { studentId: { in: [good.id, gone.id] } } })).toBe(0);
  });

  it('checks the reason, the date and the class', async () => {
    const s = await addStudent(prisma, A);
    const base = { studentIds: [s.id], toClassId: east, reason: 'PARENT_REQUEST' };
    expect((await move(A.operator!, { ...base, reason: undefined })).status).toBe(422);
    expect((await move(A.operator!, { ...base, reason: 'BOREDOM' })).status).toBe(422);
    expect((await move(A.operator!, { ...base, reason: 'OTHER' })).status).toBe(422);
    expect((await move(A.operator!, { ...base, studentIds: [] })).status).toBe(422);
    expect((await move(A.operator!, { ...base, effectiveDate: dayOffset(3) })).status).toBe(422);
    expect((await move(A.operator!, { ...base, effectiveDate: dayOffset(-90) })).status).toBe(422);
    expect((await move(A.operator!, { ...base, effectiveDate: '2026-02-30' })).status).toBe(422);
    expect((await move(A.operator!, { ...base, toClassId: A.classId })).status).toBe(409); // already there
    expect((await move(A.operator!, { ...base, effectiveDate: dayOffset(-5) })).status).toBe(200);
    const m = await prisma.classMove.findFirstOrThrow({ where: { studentId: s.id } });
    expect(m.effectiveDate.toISOString().slice(0, 10)).toBe(dayOffset(-5));
  });

  it('refuses an inactive class', async () => {
    const off = await addClass(prisma, A, 'Form 2 Closed');
    await prisma.schoolClass.update({ where: { id: off.id }, data: { active: false } });
    const s = await addStudent(prisma, A);
    expect((await move(A.operator!, { studentIds: [s.id], toClassId: off.id, reason: 'PARENT_REQUEST' })).status).toBe(409);
  });

  it('leaves every student at the school with exactly one enrollment in the open term', async () => {
    const students = await prisma.student.findMany({ where: { schoolId: A.schoolId, status: { in: ['ACTIVE', 'SUSPENDED'] } }, select: { id: true, currentClassId: true } });
    for (const s of students) {
      const rows = await prisma.enrollment.findMany({ where: { studentId: s.id, termId: A.termId } });
      expect(rows, s.id).toHaveLength(1);
      expect(rows[0]!.classId).toBe(s.currentClassId);
    }
  });
});

describe('before the term has started', () => {
  it('only corrects the enrollment, with no approval needed', async () => {
    const east2 = await addClass(prisma, C, 'Form 2 East');
    const s = await addStudent(prisma, C);
    const r = await move(C.users.TEACHER, { studentIds: [s.id], toClassId: east2.id, reason: 'WRONG_CLASS_AT_ADMISSION' });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ mode: 'CORRECTION', appliesNow: true, applied: 1, pending: 0 });
    const rows = await prisma.enrollment.findMany({ where: { studentId: s.id, termId: C.termId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classId).toBe(east2.id);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: s.id } })).currentClassId).toBe(east2.id);
    expect(await prisma.classMove.findFirstOrThrow({ where: { studentId: s.id } })).toMatchObject({ status: 'APPROVED', approvedById: null });
    expect(await prisma.auditLog.count({ where: { schoolId: C.schoolId, action: 'TRANSFER_CLASS', entityId: s.id } })).toBe(1);
  });
});

describe('houses', () => {
  it('are set up in Settings by someone who may change settings', async () => {
    expect((await call('system/houses', 'POST', { as: A.users.TEACHER, body: { name: 'Zambezi', colour: '#112233' } })).status).toBe(403);
    const r = await call('system/houses', 'POST', { as: A.operator!, body: { name: 'Zambezi', colour: '#112233' } });
    expect(r.status).toBe(201);
    expect((await call('system/houses', 'POST', { as: A.operator!, body: { name: 'zambezi' } })).status).toBe(409);
    expect((await call('system/houses', 'POST', { as: A.operator!, body: { name: 'X', colour: 'red' } })).status).toBe(422);
    const id = r.json.data.house.id;
    expect((await call('system/houses/[id]', 'PATCH', { as: A.operator!, params: { id }, body: { name: 'Zambezi Blue', colour: '#0000FF' } })).status).toBe(200);
    const list = await call('system/houses', 'GET', { as: A.operator! });
    expect(list.json.data.houses.map((h: { name: string }) => h.name)).toContain('Zambezi Blue');
  });

  it("assign to several students at once, with one audit entry each, and never reach another school's house or students", async () => {
    const h = await prisma.house.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    const a = await addStudent(prisma, A);
    const b = await addStudent(prisma, A);
    expect((await call('students/house', 'POST', { as: A.users.BURSAR, body: { studentIds: [a.id], houseId: h.id } })).status).toBe(403);
    const r = await call('students/house', 'POST', { as: A.operator!, body: { studentIds: [a.id, b.id], houseId: h.id } });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ changed: 2 });
    expect((await prisma.student.findUniqueOrThrow({ where: { id: a.id } })).houseId).toBe(h.id);
    const audit = await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: 'ASSIGN_HOUSE', entityId: { in: [a.id, b.id] } } });
    expect(audit).toHaveLength(2);
    expect(audit[0]!.after).toMatchObject({ houseId: h.id });

    const theirHouse = await prisma.house.create({ data: { schoolId: B.schoolId, name: 'Theirs' } });
    expect((await call('students/house', 'POST', { as: A.operator!, body: { studentIds: [a.id], houseId: theirHouse.id } })).status).toBe(404);
    const theirStudent = await addStudent(prisma, B);
    expect((await call('students/house', 'POST', { as: A.operator!, body: { studentIds: [theirStudent.id], houseId: h.id } })).status).toBe(404);

    // taking students out of a house, and doing nothing when nothing changes
    expect((await call('students/house', 'POST', { as: A.operator!, body: { studentIds: [a.id], houseId: null } })).json.data.changed).toBe(1);
    expect((await call('students/house', 'POST', { as: A.operator!, body: { studentIds: [a.id], houseId: null } })).json.data.changed).toBe(0);
  });

  it('are refused for students who have left', async () => {
    const h = await prisma.house.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    const gone = await addStudent(prisma, A, { status: 'WITHDRAWN' });
    expect((await call('students/house', 'POST', { as: A.operator!, body: { studentIds: [gone.id], houseId: h.id } })).status).toBe(409);
  });
});

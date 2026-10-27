// @vitest-environment node
// Discipline (incidents, suspensions that start and end by themselves, expulsion recommendations, reports) and the
// leaving process (clearance, approval, finishing, rejoining).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { addClass, addStudent, dayOffset } from '../helpers/students';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
let syncSuspensions: typeof import('@/lib/students/discipline').syncSuspensions;

const incident = (as: { id: string } | null, body: Record<string, unknown>) =>
  call('students/discipline', 'POST', {
    as: as as never,
    body: { occurredAt: `${dayOffset(-1)}T10:30`, location: 'CLASSROOM', category: 'FIGHTING', severity: 'MODERATE', description: 'Pushed a classmate in the corridor', ...body },
  });
const statusOf = async (id: string) => (await prisma.student.findUniqueOrThrow({ where: { id } })).status;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  ({ syncSuspensions } = await import('@/lib/students/discipline'));
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  await prisma.academicTerm.update({ where: { id: A.termId }, data: { startDate: new Date(`${dayOffset(-30)}T00:00:00Z`), endDate: new Date(`${dayOffset(60)}T00:00:00Z`) } });
  // The class teacher may record incidents for her own class, but cannot approve anything.
  for (const k of ['students.profiles.view', 'students.discipline.create']) await grantPermission(prisma, A.schoolId, 'TEACHER', k);
  await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.discipline.view', 'CLASS');
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('recording an incident', () => {
  it('needs students.discipline.create', async () => {
    const s = await addStudent(prisma, A);
    expect((await incident(A.users.BURSAR, { studentIds: [s.id] })).status).toBe(403);
    expect((await incident(null, { studentIds: [s.id] })).status).toBe(401);
  });

  it('is saved straight away for a warning, and leaves the student as they were', async () => {
    const s = await addStudent(prisma, A);
    const r = await incident(A.users.TEACHER, { studentIds: [s.id], category: 'UNIFORM', severity: 'MINOR', actions: [{ type: 'VERBAL_WARNING' }, { type: 'DETENTION', notes: 'Friday' }] });
    expect(r.status).toBe(201);
    const actions = await prisma.disciplineAction.findMany({ where: { studentId: s.id } });
    expect(actions.map((a) => [a.type, a.status]).sort()).toEqual([['DETENTION', 'RECORDED'], ['VERBAL_WARNING', 'RECORDED']]);
    expect(await statusOf(s.id)).toBe('ACTIVE');
    const row = await prisma.disciplineIncident.findFirstOrThrow({ where: { students: { some: { studentId: s.id } } } });
    expect(row.recordedById).toBe(A.users.TEACHER.id);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'RECORD_INCIDENT', entityId: row.id } });
    expect(audit.after).toMatchObject({ category: 'UNIFORM', severity: 'MINOR', studentIds: [s.id] });
  });

  it('can involve a group, each with their own record', async () => {
    const a = await addStudent(prisma, A);
    const b = await addStudent(prisma, A);
    const r = await incident(A.operator!, { studentIds: [a.id, b.id], actions: [{ type: 'WRITTEN_WARNING', studentIds: [a.id] }] });
    expect(r.status).toBe(201);
    expect(await prisma.incidentStudent.count({ where: { studentId: { in: [a.id, b.id] } } })).toBe(2);
    expect(await prisma.disciplineAction.count({ where: { studentId: a.id } })).toBe(1);
    expect(await prisma.disciplineAction.count({ where: { studentId: b.id } })).toBe(0);
  });

  it('has no corporal punishment to choose', async () => {
    const s = await addStudent(prisma, A);
    for (const type of ['CORPORAL_PUNISHMENT', 'CANING', 'BEATING']) {
      expect((await incident(A.operator!, { studentIds: [s.id], actions: [{ type }] })).status, type).toBe(422);
    }
    expect(await prisma.disciplineAction.count({ where: { studentId: s.id } })).toBe(0);
  });

  it('checks what was typed', async () => {
    const s = await addStudent(prisma, A);
    const bad = async (body: Record<string, unknown>) => (await incident(A.operator!, { studentIds: [s.id], ...body })).status;
    expect(await bad({ description: '' })).toBe(422);
    expect(await bad({ description: 'x' })).toBe(422);
    expect(await bad({ category: 'SULKING' })).toBe(422);
    expect(await bad({ severity: 'HUGE' })).toBe(422);
    expect(await bad({ location: 'MARS' })).toBe(422);
    expect(await bad({ occurredAt: `${dayOffset(2)}T10:00` })).toBe(422);
    expect(await bad({ occurredAt: 'yesterday' })).toBe(422);
    expect(await bad({ studentIds: [] })).toBe(422);
    expect(await bad({ actions: [{ type: 'SUSPENSION' }] })).toBe(422);
    expect(await bad({ actions: [{ type: 'SUSPENSION', startDate: dayOffset(2), endDate: dayOffset(1) }] })).toBe(422);
    expect(await prisma.disciplineIncident.count({ where: { students: { some: { studentId: s.id } } } })).toBe(0);
  });

  it("reaches only the students the user teaches and never another school's", async () => {
    const elsewhere = await addClass(prisma, A, 'Form 2 West');
    const notMine = await addStudent(prisma, A, { classId: elsewhere.id });
    const theirs = await addStudent(prisma, B);
    expect((await incident(A.users.TEACHER, { studentIds: [notMine.id] })).status).toBe(404);
    expect((await incident(A.operator!, { studentIds: [theirs.id] })).status).toBe(404);
  });

  it('is only for students at the school', async () => {
    const gone = await addStudent(prisma, A, { status: 'WITHDRAWN' });
    expect((await incident(A.operator!, { studentIds: [gone.id] })).status).toBe(409);
  });

  it('tells the approvers when it is serious', async () => {
    const s = await addStudent(prisma, A);
    await incident(A.users.TEACHER, { studentIds: [s.id], category: 'THEFT', severity: 'SERIOUS' });
    expect(await prisma.notification.count({ where: { userId: A.operator!.id, type: 'SERIOUS_INCIDENT' } })).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { userId: A.users.TEACHER.id, type: 'SERIOUS_INCIDENT' } })).toBe(0);
  });

  it('keeps the description out of the audit log', async () => {
    const s = await addStudent(prisma, A);
    await incident(A.operator!, { studentIds: [s.id], description: 'Secret detail about the fight' });
    const rows = await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, entityType: 'DisciplineIncident' } });
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain('Secret detail');
  });
});

describe('suspensions', () => {
  it('are approved at once by someone who may approve, with the approver recorded, and the student becomes Suspended', async () => {
    const s = await addStudent(prisma, A);
    const r = await incident(A.operator!, { studentIds: [s.id], severity: 'SERIOUS', actions: [{ type: 'SUSPENSION', startDate: dayOffset(0), endDate: dayOffset(3), notes: 'Three days' }] });
    expect(r.status).toBe(201);
    const a = await prisma.disciplineAction.findFirstOrThrow({ where: { studentId: s.id, type: 'SUSPENSION' } });
    expect(a).toMatchObject({ status: 'APPROVED', approvedById: A.operator!.id, requestedById: A.operator!.id });
    expect(await statusOf(s.id)).toBe('SUSPENDED');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'SUSPEND_STUDENT', entityId: s.id } });
    expect(audit.after).toMatchObject({ status: 'SUSPENDED', until: dayOffset(3) });
  });

  it('wait for the Head when someone else records them, and change nothing until approved', async () => {
    const s = await addStudent(prisma, A);
    await incident(A.users.TEACHER, { studentIds: [s.id], actions: [{ type: 'SUSPENSION', startDate: dayOffset(0), endDate: dayOffset(2) }] });
    const a = await prisma.disciplineAction.findFirstOrThrow({ where: { studentId: s.id, type: 'SUSPENSION' } });
    expect(a).toMatchObject({ status: 'PENDING', approvedById: null });
    expect(await statusOf(s.id)).toBe('ACTIVE');
    expect(await prisma.notification.count({ where: { userId: A.users.HEAD.id, type: 'DISCIPLINE_WAITING' } })).toBeGreaterThan(0);

    const decide = (as: { id: string }, body: Record<string, unknown>) => call('students/discipline/actions/[id]', 'POST', { as: as as never, params: { id: a.id }, body });
    expect((await decide(A.users.TEACHER, { decision: 'APPROVE' })).status).toBe(403); // cannot approve their own
    expect((await decide(A.operator!, { decision: 'CONFIRM_EXPULSION', decisionDate: dayOffset(0) })).status).toBe(422); // wrong kind of decision
    expect((await decide(A.users.HEAD, { decision: 'APPROVE' })).status).toBe(200);
    expect(await prisma.disciplineAction.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: 'APPROVED', approvedById: A.users.HEAD.id });
    expect(await statusOf(s.id)).toBe('SUSPENDED');
    expect((await decide(A.users.HEAD, { decision: 'APPROVE' })).status).toBe(409);
  });

  it('can be rejected', async () => {
    const s = await addStudent(prisma, A);
    await incident(A.users.TEACHER, { studentIds: [s.id], actions: [{ type: 'SUSPENSION', startDate: dayOffset(0), endDate: dayOffset(2) }] });
    const a = await prisma.disciplineAction.findFirstOrThrow({ where: { studentId: s.id, type: 'SUSPENSION' } });
    const r = await call('students/discipline/actions/[id]', 'POST', { as: A.operator!, params: { id: a.id }, body: { decision: 'REJECT', notes: 'Too harsh' } });
    expect(r.status).toBe(200);
    expect(await prisma.disciplineAction.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: 'REJECTED', approvedById: A.operator!.id });
    expect(await statusOf(s.id)).toBe('ACTIVE');
  });

  it('start on their start date when it is in the future', async () => {
    const s = await addStudent(prisma, A);
    await incident(A.operator!, { studentIds: [s.id], actions: [{ type: 'SUSPENSION', startDate: dayOffset(2), endDate: dayOffset(4) }] });
    expect(await statusOf(s.id)).toBe('ACTIVE');
    await syncSuspensions(A.schoolId, A.operator!.id, dayOffset(1));
    expect(await statusOf(s.id)).toBe('ACTIVE');
    await syncSuspensions(A.schoolId, A.operator!.id, dayOffset(2));
    expect(await statusOf(s.id)).toBe('SUSPENDED');
  });

  it('end by themselves the day after the end date, and the audit log says so', async () => {
    const s = await addStudent(prisma, A);
    await incident(A.operator!, { studentIds: [s.id], actions: [{ type: 'SUSPENSION', startDate: dayOffset(0), endDate: dayOffset(2) }] });
    expect(await statusOf(s.id)).toBe('SUSPENDED');
    await syncSuspensions(A.schoolId, A.operator!.id, dayOffset(2)); // still the last day
    expect(await statusOf(s.id)).toBe('SUSPENDED');
    const r = await syncSuspensions(A.schoolId, A.operator!.id, dayOffset(3));
    expect(r.ended).toBeGreaterThanOrEqual(1);
    expect(await statusOf(s.id)).toBe('ACTIVE');
    expect((await prisma.disciplineAction.findFirstOrThrow({ where: { studentId: s.id, type: 'SUSPENSION' } })).status).toBe('ENDED');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'END_SUSPENSION', entityId: s.id } });
    expect(audit.actorId).toBe(A.operator!.id);
    expect(audit.detail).toContain('automatically');
    // running it again does nothing
    expect((await syncSuspensions(A.schoolId, A.operator!.id, dayOffset(3))).ended).toBe(0);
  });

  it('do not bring back a student who has left in the meantime', async () => {
    const s = await addStudent(prisma, A);
    await incident(A.operator!, { studentIds: [s.id], actions: [{ type: 'SUSPENSION', startDate: dayOffset(0), endDate: dayOffset(1) }] });
    await prisma.student.update({ where: { id: s.id }, data: { status: 'WITHDRAWN' } });
    await syncSuspensions(A.schoolId, A.operator!.id, dayOffset(5));
    expect(await statusOf(s.id)).toBe('WITHDRAWN');
    expect((await prisma.disciplineAction.findFirstOrThrow({ where: { studentId: s.id, type: 'SUSPENSION' } })).status).toBe('ENDED');
  });

  it('cannot be doubled up', async () => {
    const s = await addStudent(prisma, A);
    const sus = { type: 'SUSPENSION', startDate: dayOffset(0), endDate: dayOffset(2) };
    expect((await incident(A.operator!, { studentIds: [s.id], actions: [sus] })).status).toBe(201);
    expect((await incident(A.operator!, { studentIds: [s.id], actions: [sus] })).status).toBe(409);
    expect(await prisma.disciplineAction.count({ where: { studentId: s.id, type: 'SUSPENSION' } })).toBe(1);
  });
});

describe('expulsion', () => {
  it('is only a recommendation, even from someone who can approve', async () => {
    const s = await addStudent(prisma, A);
    await incident(A.operator!, { studentIds: [s.id], severity: 'SERIOUS', actions: [{ type: 'EXPULSION_RECOMMENDED', notes: 'Repeated violence' }] });
    const a = await prisma.disciplineAction.findFirstOrThrow({ where: { studentId: s.id } });
    expect(a.status).toBe('PENDING');
    expect(await statusOf(s.id)).toBe('ACTIVE');
    expect(await prisma.studentExit.count({ where: { studentId: s.id } })).toBe(0);
  });

  it('is decided by the Head, who records the date and the authority reference, and confirming it starts the leaving process', async () => {
    const s = await addStudent(prisma, A);
    await incident(A.users.TEACHER, { studentIds: [s.id], severity: 'SERIOUS', actions: [{ type: 'EXPULSION_RECOMMENDED' }] });
    const a = await prisma.disciplineAction.findFirstOrThrow({ where: { studentId: s.id } });
    const decide = (body: Record<string, unknown>) => call('students/discipline/actions/[id]', 'POST', { as: A.operator!, params: { id: a.id }, body });
    expect((await decide({ decision: 'CONFIRM_EXPULSION' })).status).toBe(422); // a decision date is required
    expect((await decide({ decision: 'APPROVE' })).status).toBe(422);
    const r = await decide({ decision: 'CONFIRM_EXPULSION', decisionDate: dayOffset(0), authorityRef: 'MoPSE/ZIM/2026/118' });
    expect(r.status).toBe(200);
    expect(await prisma.disciplineAction.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: 'APPROVED', decision: 'CONFIRMED', authorityRef: 'MoPSE/ZIM/2026/118', approvedById: A.operator!.id });
    const exit = await prisma.studentExit.findFirstOrThrow({ where: { studentId: s.id } });
    expect(exit).toMatchObject({ reason: 'EXPELLED', state: 'STARTED' });
    expect(exit.lastDay.toISOString().slice(0, 10)).toBe(dayOffset(0));
    expect(await statusOf(s.id)).toBe('ACTIVE'); // still at the school until the leaving is finished
  });

  it('can be declined, which starts nothing', async () => {
    const s = await addStudent(prisma, A);
    await incident(A.users.TEACHER, { studentIds: [s.id], severity: 'SERIOUS', actions: [{ type: 'EXPULSION_RECOMMENDED' }] });
    const a = await prisma.disciplineAction.findFirstOrThrow({ where: { studentId: s.id } });
    const r = await call('students/discipline/actions/[id]', 'POST', { as: A.operator!, params: { id: a.id }, body: { decision: 'DECLINE_EXPULSION', decisionDate: dayOffset(0), notes: 'Final warning instead' } });
    expect(r.status).toBe(200);
    expect(await prisma.disciplineAction.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: 'REJECTED', decision: 'DECLINED' });
    expect(await prisma.studentExit.count({ where: { studentId: s.id } })).toBe(0);
  });
});

describe('guardian meetings', () => {
  it('record the date, who came and what was agreed', async () => {
    const s = await addStudent(prisma, A);
    await incident(A.users.TEACHER, { studentIds: [s.id], actions: [{ type: 'GUARDIAN_CALLED_IN' }] });
    const a = await prisma.disciplineAction.findFirstOrThrow({ where: { studentId: s.id } });
    const meet = (as: { id: string }, body: Record<string, unknown>) => call('students/discipline/actions/[id]/meeting', 'POST', { as: as as never, params: { id: a.id }, body });
    expect((await meet(A.users.BURSAR, { meetingDate: dayOffset(0), attendees: 'Mother', outcome: 'Agreed' })).status).toBe(403);
    expect((await meet(A.users.TEACHER, { meetingDate: dayOffset(0), attendees: 'Mother', outcome: '' })).status).toBe(422);
    expect((await meet(A.users.TEACHER, { meetingDate: dayOffset(0), attendees: 'Mother', outcome: 'Agreed', letterKey: `sdoc:${B.schoolId}:abc` })).status).toBe(422);
    expect((await meet(A.users.TEACHER, { meetingDate: dayOffset(0), attendees: 'Mother and uncle', outcome: 'Agreed to monitor homework', letterKey: `sdoc:${A.schoolId}:abc` })).status).toBe(200);
    expect(await prisma.disciplineAction.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ meetingAttendees: 'Mother and uncle', meetingOutcome: 'Agreed to monitor homework', meetingLetterKey: `sdoc:${A.schoolId}:abc` });
  });

  it('belong to a "guardian called in" action', async () => {
    const s = await addStudent(prisma, A);
    await incident(A.users.TEACHER, { studentIds: [s.id], actions: [{ type: 'DETENTION' }] });
    const a = await prisma.disciplineAction.findFirstOrThrow({ where: { studentId: s.id } });
    expect((await call('students/discipline/actions/[id]/meeting', 'POST', { as: A.operator!, params: { id: a.id }, body: { meetingDate: dayOffset(0), attendees: 'Mother', outcome: 'Agreed' } })).status).toBe(409);
  });
});

describe('the record and the reports', () => {
  it("shows a student's incidents newest first, only to those who may see discipline", async () => {
    const s = await addStudent(prisma, A);
    await incident(A.operator!, { studentIds: [s.id], occurredAt: `${dayOffset(-5)}T09:00`, category: 'LATE_COMING', severity: 'MINOR', description: 'Late for assembly' });
    await incident(A.operator!, { studentIds: [s.id], occurredAt: `${dayOffset(-2)}T09:00`, category: 'HOMEWORK', severity: 'MINOR', description: 'No homework again' });
    const r = await call('students/[id]/discipline', 'GET', { as: A.operator!, params: { id: s.id } });
    expect(r.json.data.incidents.map((i: { category: string }) => i.category)).toEqual(['HOMEWORK', 'LATE_COMING']);
    expect((await call('students/[id]/discipline', 'GET', { as: A.users.BURSAR, params: { id: s.id } })).status).toBe(403);
    expect((await call('students/[id]/discipline', 'GET', { as: A.operator!, params: { id: (await addStudent(prisma, B)).id } })).status).toBe(404);
  });

  it('count incidents by category, class and month, and list students with 3 or more and open suspensions', async () => {
    const s = await addStudent(prisma, A);
    for (const category of ['LATE_COMING', 'LATE_COMING', 'PHONE_USE']) {
      await incident(A.operator!, { studentIds: [s.id], category, severity: 'MINOR', description: 'Repeated issue' });
    }
    await incident(A.operator!, { studentIds: [s.id], actions: [{ type: 'SUSPENSION', startDate: dayOffset(0), endDate: dayOffset(1) }] });
    const r = await call('students/discipline', 'GET', { as: A.operator! });
    expect(r.status).toBe(200);
    const report = r.json.data;
    expect(report.byCategory.find((c: { category: string }) => c.category === 'LATE_COMING').count).toBeGreaterThanOrEqual(2);
    expect(report.byClass.length).toBeGreaterThan(0);
    expect(report.byMonth.length).toBeGreaterThan(0);
    expect(report.repeaters.map((x: { studentId: string; count: number }) => [x.studentId, x.count])).toContainEqual([s.id, 4]);
    expect(report.openSuspensions.map((x: { studentId: string }) => x.studentId)).toContain(s.id);
  });

  it('are limited to the students the user teaches', async () => {
    const elsewhere = await addClass(prisma, A, 'Form 2 East');
    const other = await addStudent(prisma, A, { classId: elsewhere.id });
    for (let i = 0; i < 3; i++) await incident(A.operator!, { studentIds: [other.id], category: 'HOMEWORK', severity: 'MINOR', description: 'No homework' });
    const mine = (await call('students/discipline', 'GET', { as: A.users.TEACHER })).json.data;
    expect(mine.repeaters.map((x: { studentId: string }) => x.studentId)).not.toContain(other.id);
    const all = (await call('students/discipline', 'GET', { as: A.operator! })).json.data;
    expect(all.repeaters.map((x: { studentId: string }) => x.studentId)).toContain(other.id);
  });
});

// ─── Leaving ─────────────────────────────────────────────────────────────────

const leave = (as: { id: string } | null, body: Record<string, unknown>) =>
  call('students/leaving', 'POST', { as: as as never, body: { reason: 'WITHDRAWN_BY_GUARDIAN', lastDay: dayOffset(0), ...body } });
const step = (as: { id: string } | null, id: string, body: Record<string, unknown>) => call('students/leaving/[id]', 'POST', { as: as as never, params: { id }, body });

describe('starting to leave', () => {
  it('needs students.leavers.manage', async () => {
    const s = await addStudent(prisma, A);
    expect((await leave(A.users.TEACHER, { studentId: s.id })).status).toBe(403);
    expect((await leave(null, { studentId: s.id })).status).toBe(401);
  });

  it('checks the reason, the last day and, for a transfer, the school and district', async () => {
    const s = await addStudent(prisma, A);
    expect((await leave(A.operator!, { studentId: s.id, reason: 'RUNAWAY' })).status).toBe(422);
    expect((await leave(A.operator!, { studentId: s.id, reason: 'TRANSFER' })).status).toBe(422);
    expect((await leave(A.operator!, { studentId: s.id, reason: 'TRANSFER', destinationSchool: 'Goromonzi High' })).status).toBe(422);
    expect((await leave(A.operator!, { studentId: s.id, reason: 'OTHER' })).status).toBe(422);
    expect((await leave(A.operator!, { studentId: s.id, lastDay: '2020-01-01' })).status).toBe(422);
    expect((await leave(A.operator!, { studentId: s.id, lastDay: 'soon' })).status).toBe(422);
    expect((await leave(A.operator!, { studentId: s.id, reason: 'TRANSFER', destinationSchool: 'Goromonzi High', destinationDistrict: 'Goromonzi' })).status).toBe(201);
  });

  it('fills the clearance from the modules that are on, and leaves the rest to be ticked', async () => {
    const s = await addStudent(prisma, A);
    await prisma.charge.create({ data: { schoolId: A.schoolId, studentId: s.id, termId: A.termId, label: 'Tuition', currency: 'USD', amount: 80 } });
    await prisma.payment.create({ data: { schoolId: A.schoolId, studentId: s.id, currency: 'USD', amount: 30, method: 'CASH', feeLabel: 'Tuition', status: 'VERIFIED', recordedBy: A.users.BURSAR.id } });
    const member = await prisma.libraryMember.create({ data: { schoolId: A.schoolId, memberType: 'STUDENT', studentId: s.id } });
    const book = await prisma.book.create({ data: { schoolId: A.schoolId, title: 'Things Fall Apart', author: 'Achebe' } });
    const copy = await prisma.bookCopy.create({ data: { schoolId: A.schoolId, bookId: book.id, accessionNumber: `LEAVE-${s.id.slice(-6)}` } });
    await prisma.borrowing.create({ data: { schoolId: A.schoolId, copyId: copy.id, memberId: member.id, checkoutDate: new Date(), dueDate: new Date(Date.now() + 864e5) } });

    const r = await leave(A.operator!, { studentId: s.id });
    expect(r.status).toBe(201);
    const byKey = Object.fromEntries(r.json.data.exit.clearance.map((c: { key: string }) => [c.key, c]));
    expect(byKey.fees).toMatchObject({ source: 'auto', clear: false, detail: 'USD 50.00 outstanding' });
    expect(byKey.library).toMatchObject({ source: 'auto', clear: false });
    expect(byKey.library.detail).toContain('Things Fall Apart');
    for (const k of ['hostel', 'property', 'sports_kit']) expect(byKey[k]).toMatchObject({ source: 'manual', clear: false });
  });

  it('shows Clear for a student who owes nothing, and uses ticks when a module is off', async () => {
    const s = await addStudent(prisma, A);
    const r = await leave(A.operator!, { studentId: s.id });
    const byKey = Object.fromEntries(r.json.data.exit.clearance.map((c: { key: string }) => [c.key, c]));
    expect(byKey.fees).toMatchObject({ clear: true, detail: 'Clear' });
    expect(byKey.library).toMatchObject({ clear: true });
    await prisma.schoolModule.upsert({ where: { schoolId_module: { schoolId: A.schoolId, module: 'finance' } }, update: { enabled: false }, create: { schoolId: A.schoolId, module: 'finance', enabled: false } });
    const s2 = await addStudent(prisma, A);
    const r2 = await leave(A.operator!, { studentId: s2.id });
    expect(r2.json.data.exit.clearance.find((c: { key: string }) => c.key === 'fees')).toMatchObject({ source: 'manual', clear: false });
    await prisma.schoolModule.update({ where: { schoolId_module: { schoolId: A.schoolId, module: 'finance' } }, data: { enabled: true } });
  });

  it('can be open only once per student, and can be cancelled and started again', async () => {
    const s = await addStudent(prisma, A);
    const first = await leave(A.operator!, { studentId: s.id });
    expect((await leave(A.operator!, { studentId: s.id })).status).toBe(409);
    const id = first.json.data.exit.id;
    expect((await step(A.operator!, id, { action: 'cancel', reason: 'Started by mistake' })).status).toBe(200);
    expect(await statusOf(s.id)).toBe('ACTIVE');
    expect((await leave(A.operator!, { studentId: s.id })).status).toBe(201);
  });

  it('is only for students at the school', async () => {
    const gone = await addStudent(prisma, A, { status: 'TRANSFERRED' });
    expect((await leave(A.operator!, { studentId: gone.id })).status).toBe(409);
    expect((await leave(A.operator!, { studentId: (await addStudent(prisma, B)).id })).status).toBe(404);
  });
});

describe('approving and finishing', () => {
  it('needs the Head to approve first, and approval needs students.leavers.approve', async () => {
    const s = await addStudent(prisma, A);
    const exit = (await leave(A.operator!, { studentId: s.id })).json.data.exit;
    expect((await step(A.operator!, exit.id, { action: 'complete' })).status).toBe(409); // not approved yet
    await grantPermission(prisma, A.schoolId, 'BURSAR', 'students.leavers.manage');
    expect((await step(A.users.BURSAR, exit.id, { action: 'approve' })).status).toBe(403);
    expect((await step(A.operator!, exit.id, { action: 'approve', overrideReason: 'Hand-checked items done on paper' })).status).toBe(200);
    expect(await prisma.studentExit.findUniqueOrThrow({ where: { id: exit.id } })).toMatchObject({ state: 'APPROVED', approvedById: A.operator!.id });
    expect((await step(A.operator!, exit.id, { action: 'approve' })).status).toBe(409);
  });

  it('can leave with items outstanding only when the approver says why, and that is recorded', async () => {
    const s = await addStudent(prisma, A);
    await prisma.charge.create({ data: { schoolId: A.schoolId, studentId: s.id, termId: A.termId, label: 'Tuition', currency: 'USD', amount: 40 } });
    const exit = (await leave(A.operator!, { studentId: s.id })).json.data.exit;
    const refused = await step(A.operator!, exit.id, { action: 'approve' });
    expect(refused.status).toBe(409);
    expect(refused.json.message).toContain('Fees balance');
    expect((await step(A.operator!, exit.id, { action: 'approve', overrideReason: 'ok' })).status).toBe(409); // too short
    const ok = await step(A.operator!, exit.id, { action: 'approve', overrideReason: 'Guardian agreed a payment plan with the bursar' });
    expect(ok.status).toBe(200);
    expect(ok.json.data.outstanding).toContain('fees');
    const row = await prisma.studentExit.findUniqueOrThrow({ where: { id: exit.id } });
    expect(row.overrideReason).toBe('Guardian agreed a payment plan with the bursar');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'APPROVE_LEAVING', entityId: exit.id } });
    expect(audit.after).toMatchObject({ approvedById: A.operator!.id, overrideReason: 'Guardian agreed a payment plan with the bursar' });
  });

  it('lets hand-checked lines be ticked, but not the ones a module fills in', async () => {
    const s = await addStudent(prisma, A);
    const exit = (await leave(A.operator!, { studentId: s.id })).json.data.exit;
    expect((await step(A.operator!, exit.id, { action: 'tick', key: 'fees', ticked: true })).status).toBe(409);
    for (const key of ['hostel', 'property', 'sports_kit']) expect((await step(A.operator!, exit.id, { action: 'tick', key, ticked: true })).status).toBe(200);
    const ok = await step(A.operator!, exit.id, { action: 'approve' }); // nothing outstanding now, so no reason needed
    expect(ok.status).toBe(200);
    expect(ok.json.data.outstanding).toEqual([]);
  });

  it('checks the clearance again at approval time', async () => {
    const s = await addStudent(prisma, A);
    const exit = (await leave(A.operator!, { studentId: s.id })).json.data.exit;
    for (const key of ['hostel', 'property', 'sports_kit']) await step(A.operator!, exit.id, { action: 'tick', key, ticked: true });
    await prisma.charge.create({ data: { schoolId: A.schoolId, studentId: s.id, termId: A.termId, label: 'Late levy', currency: 'USD', amount: 10 } });
    expect((await step(A.operator!, exit.id, { action: 'approve' })).status).toBe(409);
  });

  it('sets the status, ends the enrollment on the last day and takes the student off class lists', async () => {
    const s = await addStudent(prisma, A);
    const exit = (await leave(A.operator!, { studentId: s.id, reason: 'TRANSFER', destinationSchool: 'Goromonzi High', destinationDistrict: 'Goromonzi', lastDay: dayOffset(0) })).json.data.exit;
    await step(A.operator!, exit.id, { action: 'approve', overrideReason: 'Nothing owed; ticking skipped' });
    const done = await step(A.operator!, exit.id, { action: 'complete' });
    expect(done.status).toBe(200);
    expect(done.json.data.status).toBe('TRANSFERRED');
    const student = await prisma.student.findUniqueOrThrow({ where: { id: s.id } });
    expect(student).toMatchObject({ status: 'TRANSFERRED', currentClassId: null });
    const enr = await prisma.enrollment.findUniqueOrThrow({ where: { studentId_termId: { studentId: s.id, termId: A.termId } } });
    expect(enr).toMatchObject({ status: 'TRANSFERRED_OUT' });
    expect(enr.endDate!.toISOString().slice(0, 10)).toBe(dayOffset(0));
    expect(await prisma.studentExit.findUniqueOrThrow({ where: { id: exit.id } })).toMatchObject({ state: 'COMPLETED', resultingStatus: 'TRANSFERRED' });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'COMPLETE_LEAVING', entityId: s.id } });
    expect(audit.before).toMatchObject({ status: 'ACTIVE' });
    expect(audit.after).toMatchObject({ status: 'TRANSFERRED', approvedById: A.operator!.id });
    const list = await call('students', 'GET', { as: A.operator!, query: `?classId=${A.classId}` });
    expect(list.json.data.rows.map((r: { id: string }) => r.id)).not.toContain(s.id);
    expect((await step(A.operator!, exit.id, { action: 'complete' })).status).toBe(409); // only once
  });

  it('waits for the last day before finishing', async () => {
    const s = await addStudent(prisma, A);
    const exit = (await leave(A.operator!, { studentId: s.id, lastDay: dayOffset(5) })).json.data.exit;
    await step(A.operator!, exit.id, { action: 'approve', overrideReason: 'Approved in advance' });
    const r = await step(A.operator!, exit.id, { action: 'complete' });
    expect(r.status).toBe(409);
    expect(await statusOf(s.id)).toBe('ACTIVE');
  });

  it('turns students who completed O Level or A Level into alumni, and others not', async () => {
    const grad = await addStudent(prisma, A);
    const e1 = (await leave(A.operator!, { studentId: grad.id, reason: 'COMPLETED_O_LEVEL' })).json.data.exit;
    await step(A.operator!, e1.id, { action: 'approve', overrideReason: 'Clearance done on paper' });
    expect((await step(A.operator!, e1.id, { action: 'complete' })).json.data.status).toBe('GRADUATED');
    const alumnus = await prisma.alumnus.findUniqueOrThrow({ where: { studentId: grad.id } });
    expect(alumnus).toMatchObject({ lastClass: 'Form 1 North' });
    expect(alumnus.yearLeft).toBe(Number(dayOffset(0).slice(0, 4)));

    const other = await addStudent(prisma, A);
    const e2 = (await leave(A.operator!, { studentId: other.id, reason: 'RELOCATED_ABROAD' })).json.data.exit;
    await step(A.operator!, e2.id, { action: 'approve', overrideReason: 'Clearance done on paper' });
    await step(A.operator!, e2.id, { action: 'complete' });
    expect(await statusOf(other.id)).toBe('WITHDRAWN');
    expect(await prisma.alumnus.count({ where: { studentId: other.id } })).toBe(0);
  });

  it('ends a running suspension and suspends library borrowing', async () => {
    const s = await addStudent(prisma, A);
    await prisma.libraryMember.create({ data: { schoolId: A.schoolId, memberType: 'STUDENT', studentId: s.id } });
    await incident(A.operator!, { studentIds: [s.id], actions: [{ type: 'SUSPENSION', startDate: dayOffset(0), endDate: dayOffset(10) }] });
    const e = (await leave(A.operator!, { studentId: s.id, reason: 'EXPELLED' })).json.data.exit;
    await step(A.operator!, e.id, { action: 'approve', overrideReason: 'Expulsion confirmed' });
    await step(A.operator!, e.id, { action: 'complete' });
    expect(await statusOf(s.id)).toBe('EXPELLED');
    expect((await prisma.disciplineAction.findFirstOrThrow({ where: { studentId: s.id, type: 'SUSPENSION' } })).status).toBe('ENDED');
    expect((await prisma.libraryMember.findFirstOrThrow({ where: { studentId: s.id } })).borrowingSuspended).toBe(true);
  });
});

describe('the leavers list and rejoining', () => {
  it('lists everyone who left, filtered by year, reason and last class', async () => {
    const all = await call('students/leaving', 'GET', { as: A.operator! });
    expect(all.status).toBe(200);
    expect(all.json.data.total).toBeGreaterThan(2);
    const year = Number(dayOffset(0).slice(0, 4));
    const filtered = await call('students/leaving', 'GET', { as: A.operator!, query: `?year=${year}&reason=COMPLETED_O_LEVEL&classId=${A.classId}` });
    expect(filtered.json.data.rows.length).toBeGreaterThan(0);
    for (const r of filtered.json.data.rows) expect(r).toMatchObject({ reason: 'COMPLETED_O_LEVEL', lastClass: 'Form 1 North' });
    expect((await call('students/leaving', 'GET', { as: A.operator!, query: `?year=${year - 5}` })).json.data.rows).toHaveLength(0);
    expect((await call('students/leaving', 'GET', { as: A.users.TEACHER })).status).toBe(403);
    expect(JSON.stringify((await call('students/leaving', 'GET', { as: B.operator! })).json)).not.toContain(A.schoolId);
  });

  it('puts a former student back on their old record with the same admission number', async () => {
    const s = await addStudent(prisma, A);
    const before = s.admissionNumber;
    const e = (await leave(A.operator!, { studentId: s.id, reason: 'WITHDRAWN_BY_GUARDIAN' })).json.data.exit;
    await step(A.operator!, e.id, { action: 'approve', overrideReason: 'Clearance done on paper' });
    await step(A.operator!, e.id, { action: 'complete' });
    expect(await statusOf(s.id)).toBe('WITHDRAWN');

    const rejoin = (as: { id: string }, body: Record<string, unknown>) => call('students/[id]/rejoin', 'POST', { as: as as never, params: { id: s.id }, body });
    expect((await rejoin(A.users.TEACHER, { classId: A.classId })).status).toBe(403);
    const r = await rejoin(A.operator!, { classId: A.classId, note: 'Guardian returned' });
    expect(r.status).toBe(200);
    const back = await prisma.student.findUniqueOrThrow({ where: { id: s.id } });
    expect(back).toMatchObject({ status: 'ACTIVE', admissionNumber: before, currentClassId: A.classId, entryType: 'RETURNING' });
    const rows = await prisma.enrollment.findMany({ where: { studentId: s.id, termId: A.termId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'ACTIVE', endDate: null });
    expect(await prisma.studentExit.count({ where: { studentId: s.id } })).toBe(1); // history stays
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'REJOIN_STUDENT', entityId: s.id } })).toBe(1);
    expect((await rejoin(A.operator!, { classId: A.classId })).status).toBe(409); // already at the school
  });

  it('is not possible for an expelled student', async () => {
    const s = await addStudent(prisma, A, { status: 'EXPELLED' });
    expect((await call('students/[id]/rejoin', 'POST', { as: A.operator!, params: { id: s.id }, body: { classId: A.classId } })).status).toBe(409);
  });

  it('warns about a full class', async () => {
    const tiny = await addClass(prisma, A, 'Form 4 Tiny', { capacity: 1, order: 4 });
    await addStudent(prisma, A, { classId: tiny.id });
    const gone = await addStudent(prisma, A, { status: 'TRANSFERRED' });
    const call1 = await call('students/[id]/rejoin', 'POST', { as: A.operator!, params: { id: gone.id }, body: { classId: tiny.id } });
    expect(call1.status).toBe(409);
    expect(call1.json.message).toContain('capacity is 1');
    expect((await call('students/[id]/rejoin', 'POST', { as: A.operator!, params: { id: gone.id }, body: { classId: tiny.id, acknowledgeFull: true } })).status).toBe(200);
  });
});

describe('students are never deleted', () => {
  it('stay in the database whatever happens: the database itself refuses', async () => {
    const s = await addStudent(prisma, A);
    await expect(prisma.student.delete({ where: { id: s.id } })).rejects.toThrow(/never deleted/);
    await expect(prisma.student.deleteMany({ where: { id: s.id } })).rejects.toThrow(/never deleted/);
    expect(await prisma.student.count({ where: { id: s.id } })).toBe(1);
  });
});

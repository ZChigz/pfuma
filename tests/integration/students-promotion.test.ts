// @vitest-environment node
// The year-end promotion wizard: proposals, exceptions, drafts that change nothing, review, the Head's confirmation
// in one transaction, and opening the new year afterwards.
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
let term1_2027: string;
let year2026: string;
const ids: Record<string, string> = {};
const cls: Record<string, string> = {};

const state = (as = A.users.ADMIN, query = '') => call('students/promotion', 'GET', { as, query });
const lineOf = (r: { json: { data: { promotion: { lines: { studentId: string }[] } } } }, studentId: string) =>
  r.json.data.promotion.lines.find((l) => l.studentId === studentId) as unknown as Record<string, unknown>;
const save = (decisions: unknown[], as = A.users.ADMIN) => call('students/promotion', 'PUT', { as, body: { fromYearId: year2026, decisions } });
const confirm = (runId: string, body: Record<string, unknown> = {}, as = A.users.ADMIN) => call('students/promotion/[runId]/confirm', 'POST', { as, params: { runId }, body });

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  year2026 = A.yearId;

  // The seeded term becomes Term 3 2026, closed; 2027 and its Term 1 exist.
  await prisma.academicTerm.update({ where: { id: A.termId }, data: { termNumber: 3, name: 'Term 3 2026', status: 'CLOSED', closedAt: new Date(), startDate: new Date('2026-09-01'), endDate: new Date('2026-12-04') } });
  const y27 = await prisma.academicYear.create({ data: { schoolId: A.schoolId, year: 2027, startDate: new Date('2027-01-01'), endDate: new Date('2027-12-31') } });
  term1_2027 = (await prisma.academicTerm.create({ data: { schoolId: A.schoolId, academicYearId: y27.id, termNumber: 1, name: 'Term 1 2027', startDate: new Date('2027-01-12'), endDate: new Date('2027-04-08') } })).id;

  cls.f1n = A.classId; // Form 1 North
  cls.f1e = (await addClass(prisma, A, 'Form 1 East', { order: 1 })).id;
  cls.f2e = (await addClass(prisma, A, 'Form 2 East', { order: 2 })).id;
  cls.f3n = (await addClass(prisma, A, 'Form 3 North', { order: 3, capacity: 2 })).id;
  cls.f4n = (await addClass(prisma, A, 'Form 4 North', { order: 4 })).id;
  cls.f5a = (await addClass(prisma, A, 'Form 5 Arts', { order: 5 })).id;
  cls.f6a = (await addClass(prisma, A, 'Form 6 Arts', { order: 6 })).id;
  const mk = async (key: string, classId: string, extra: Record<string, unknown> = {}) => { ids[key] = (await addStudent(prisma, A, { classId, firstName: key.replace(/\d/g, ''), surname: 'Pupil', ...extra })).id; };
  await mk('Anna', cls.f1n); await mk('Ben', cls.f1e); await mk('Cara', cls.f2e); await mk('Dan', cls.f3n); await mk('Eve', cls.f3n); await mk('Finn', cls.f3n);
  await mk('Gift', cls.f4n); await mk('Hope', cls.f4n); await mk('Ivy', cls.f5a); await mk('Joe', cls.f6a); await mk('Kate', cls.f2e, { status: 'SUSPENDED' });
  await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.promotion.manage'); // may prepare, may not approve
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('step 1: the new year', () => {
  it('is only for those who may manage promotions', async () => {
    expect((await state(A.users.BURSAR)).status).toBe(403);
    expect((await state(null as never)).status).toBe(401);
    expect((await state(A.users.TEACHER)).status).toBe(200);
  });

  it('finds the closed Term 3 and checks that the next year and its Term 1 exist', async () => {
    const p = (await state()).json.data.promotion;
    expect(p).toMatchObject({ fromYear: { year: 2026 }, toYear: { year: 2027 }, term3: { name: 'Term 3 2026', status: 'CLOSED' }, term1: { name: 'Term 1 2027' }, problems: [], draft: null });
  });

  it('says what is missing', async () => {
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { status: 'OPEN' } });
    expect((await state()).json.data.promotion).toBeNull(); // no closed Term 3 yet to promote from
    const named = (await state(A.users.ADMIN, `?fromYearId=${year2026}`)).json.data.promotion;
    expect(named.problems.join()).toContain('Term 3 2026 is not closed');
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { status: 'CLOSED' } });
    await prisma.academicTerm.update({ where: { id: term1_2027 }, data: { termNumber: 2 } });
    expect((await state()).json.data.promotion.problems.join()).toContain('has no Term 1');
    await prisma.academicTerm.update({ where: { id: term1_2027 }, data: { termNumber: 1 } });
    const other = (await call('students/promotion', 'GET', { as: B.users.ADMIN, query: `?fromYearId=${year2026}` }));
    expect(other.status).toBe(404); // another school's year
  });
});

describe('steps 2 and 3: proposals and exceptions', () => {
  it('proposes the next form in the same stream, completes Form 4 and Upper 6, and moves Lower 6 up', async () => {
    const r = await state();
    expect(r.json.data.promotion.lines).toHaveLength(12); // the eleven below and the seeded Form 1 North student
    const f = (key: string) => lineOf(r, ids[key]!);
    expect(f('Anna')).toMatchObject({ outcome: 'PROMOTE', toClassName: 'Form 2 North', toClassId: null }); // class does not exist yet: made on confirmation
    expect(f('Ben')).toMatchObject({ outcome: 'PROMOTE', toClassName: 'Form 2 East', toClassId: cls.f2e });
    expect(f('Cara')).toMatchObject({ outcome: 'PROMOTE', toClassName: 'Form 3 East' });
    expect(f('Dan')).toMatchObject({ outcome: 'PROMOTE', toClassId: cls.f4n, toClassName: 'Form 4 North' });
    expect(f('Gift')).toMatchObject({ outcome: 'COMPLETE', exitReason: 'COMPLETED_O_LEVEL', toClassId: null });
    expect(f('Ivy')).toMatchObject({ outcome: 'PROMOTE', toClassName: 'Form 6 Arts', toClassId: cls.f6a });
    expect(f('Joe')).toMatchObject({ outcome: 'COMPLETE', exitReason: 'COMPLETED_A_LEVEL' });
    expect(f('Kate')).toMatchObject({ outcome: 'PROMOTE' }); // a suspended student is still at the school
    expect(r.json.data.promotion.review.exceptions).toBe(0);
  });

  it('leaves out students who have already left', async () => {
    const gone = await addStudent(prisma, A, { classId: cls.f2e, status: 'WITHDRAWN', firstName: 'Gone' });
    const r = await state();
    expect(r.json.data.promotion.lines.map((l: { studentId: string }) => l.studentId)).not.toContain(gone.id);
  });

  it('saves a draft of the exceptions only, and changes nothing about any student', async () => {
    const snapshot = async () => JSON.stringify({
      students: await prisma.student.findMany({ where: { schoolId: A.schoolId }, orderBy: { id: 'asc' }, select: { id: true, status: true, currentClassId: true } }),
      enrollments: await prisma.enrollment.findMany({ where: { schoolId: A.schoolId }, orderBy: { id: 'asc' }, select: { id: true, status: true, classId: true, termId: true } }),
    });
    const before = await snapshot();
    const r = await save([
      { studentId: ids.Cara, outcome: 'REPEAT' },
      { studentId: ids.Anna, outcome: 'MOVE_STREAM', toClassId: cls.f2e, note: 'Parent asked' },
      { studentId: ids.Hope, outcome: 'CONTINUE_LOWER_6', toClassId: cls.f5a },
      { studentId: ids.Eve, outcome: 'LEAVE', exitReason: 'TRANSFER' },
      { studentId: ids.Finn, outcome: 'PROMOTE' }, // the proposal anyway: not kept as an exception
    ]);
    expect(r.status).toBe(200);
    expect(r.json.data.decisions).toBe(4);
    expect(await snapshot()).toBe(before);
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'SAVE_PROMOTION_DRAFT' } })).toBe(1);
    const s = await state();
    expect(s.json.data.promotion.draft).toMatchObject({ decisions: 4 });
    const f = (key: string) => lineOf(s, ids[key]!);
    expect(f('Cara')).toMatchObject({ outcome: 'REPEAT', toClassId: cls.f2e });
    expect(f('Anna')).toMatchObject({ outcome: 'MOVE_STREAM', toClassId: cls.f2e, note: 'Parent asked' });
    expect(f('Hope')).toMatchObject({ outcome: 'CONTINUE_LOWER_6', toClassId: cls.f5a });
    expect(f('Eve')).toMatchObject({ outcome: 'LEAVE', exitReason: 'TRANSFER' });
    expect(s.json.data.promotion.review.exceptions).toBe(4); // Cara, Anna, Hope and Eve; Gift and Joe complete as proposed
  });

  it('can be saved again, replacing the decisions, and is checked decision by decision', async () => {
    const bad = async (decisions: unknown[]) => (await save(decisions)).status;
    expect(await bad([{ studentId: ids.Gift, outcome: 'PROMOTE' }])).toBe(422); // Form 4 completes or continues to Lower 6
    expect(await bad([{ studentId: ids.Joe, outcome: 'PROMOTE' }])).toBe(422);
    expect(await bad([{ studentId: ids.Anna, outcome: 'MOVE_STREAM' }])).toBe(422); // which class?
    expect(await bad([{ studentId: ids.Anna, outcome: 'MOVE_STREAM', toClassId: cls.f1n }])).toBe(422); // wrong form
    expect(await bad([{ studentId: ids.Anna, outcome: 'LEAVE' }])).toBe(422); // why?
    expect(await bad([{ studentId: ids.Anna, outcome: 'LEAVE', exitReason: 'COMPLETED_O_LEVEL' }])).toBe(422);
    expect(await bad([{ studentId: ids.Anna, outcome: 'FLY' }])).toBe(422);
    expect(await bad([{ studentId: 'not-a-student', outcome: 'REPEAT' }])).toBe(422);
    expect(await bad([{ studentId: ids.Anna, outcome: 'REPEAT' }, { studentId: ids.Anna, outcome: 'PROMOTE' }])).toBe(422);
    expect(await bad([{ studentId: ids.Anna, outcome: 'OTHER_CLASS', toClassId: B.classId }])).toBe(422); // another school's class
    expect((await save([{ studentId: ids.Cara, outcome: 'REPEAT' }, { studentId: ids.Hope, outcome: 'CONTINUE_LOWER_6', toClassId: cls.f5a }, { studentId: ids.Eve, outcome: 'LEAVE', exitReason: 'TRANSFER' }, { studentId: ids.Anna, outcome: 'REPEAT' }])).json.data.decisions).toBe(4);
    expect(await prisma.promotionRun.count({ where: { schoolId: A.schoolId, status: 'DRAFT' } })).toBe(1); // one draft per year
  });
});

describe('step 4: review', () => {
  it('counts students per new class against capacity and lists the leavers', async () => {
    const r = (await state()).json.data.promotion.review;
    const by = Object.fromEntries(r.perClass.map((c: { className: string }) => [c.className, c]));
    expect(by['Form 2 East']).toMatchObject({ incoming: 2, capacity: 45, willBeCreated: false }); // Cara repeats and Ben moves up from Form 1 East
    expect(by['Form 4 North']).toMatchObject({ incoming: 2, willBeCreated: false }); // Dan and Finn
    expect(by['Form 3 East']).toMatchObject({ incoming: 1, willBeCreated: true }); // Kate; the class is made on confirmation
    expect(r.overCapacity).toEqual([]);
    expect(r.leavers.map((l: { fullName: string; outcome: string }) => [l.fullName.split(' ')[0], l.outcome]).sort()).toEqual([['Eve', 'LEAVE'], ['Gift', 'COMPLETE'], ['Joe', 'COMPLETE']]);
    expect(r.counts).toMatchObject({ REPEAT: 2, CONTINUE_LOWER_6: 1, LEAVE: 1, COMPLETE: 2 });
  });
});

describe('step 5: confirm', () => {
  let runId: string;

  it('needs the Head: someone who may only manage cannot confirm, and neither can another school', async () => {
    runId = (await prisma.promotionRun.findFirstOrThrow({ where: { schoolId: A.schoolId, status: 'DRAFT' } })).id;
    expect((await confirm(runId, {}, A.users.TEACHER)).status).toBe(403);
    expect((await confirm(runId, {}, B.users.ADMIN)).status).toBe(404);
    expect((await confirm(runId, {}, null as never)).status).toBe(401);
    expect(await prisma.promotionRun.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({ status: 'DRAFT', approvedById: null });
  });

  it('refuses while a student has a leaving process open, and when the draft is out of date, changing nothing', async () => {
    const exit = await prisma.studentExit.create({ data: { schoolId: A.schoolId, studentId: ids.Dan!, reason: 'OTHER', reasonNote: 'x', lastDay: new Date('2026-12-01'), startedById: A.users.ADMIN.id, state: 'STARTED' } });
    const r = await confirm(runId);
    expect(r.status).toBe(409);
    expect(r.json.message).toContain('leaving process open');
    await prisma.studentExit.update({ where: { id: exit.id }, data: { state: 'CANCELLED' } });
    expect(await prisma.enrollment.count({ where: { termId: term1_2027 } })).toBe(0);

    // a student leaves after the draft was saved
    const run = await prisma.promotionRun.findUniqueOrThrow({ where: { id: runId } });
    await prisma.promotionRun.update({ where: { id: runId }, data: { lines: [...(run.lines as unknown[]), { studentId: 'ghost', outcome: 'REPEAT' }] as never } });
    expect((await confirm(runId)).status).toBe(409);
    await prisma.promotionRun.update({ where: { id: runId }, data: { lines: run.lines as never } });
  });

  it('wants the person to accept a class that would be over capacity, and changes nothing until they do', async () => {
    // Form 3 North (capacity 1) would keep both Dan and Finn
    await save([{ studentId: ids.Cara, outcome: 'REPEAT' }, { studentId: ids.Hope, outcome: 'CONTINUE_LOWER_6', toClassId: cls.f5a }, { studentId: ids.Eve, outcome: 'LEAVE', exitReason: 'TRANSFER' }, { studentId: ids.Anna, outcome: 'REPEAT' }, { studentId: ids.Dan, outcome: 'REPEAT' }, { studentId: ids.Finn, outcome: 'REPEAT' }]);
    runId = (await prisma.promotionRun.findFirstOrThrow({ where: { schoolId: A.schoolId, status: 'DRAFT' } })).id;
    const classesBefore = await prisma.schoolClass.count({ where: { schoolId: A.schoolId } });
    await prisma.schoolClass.update({ where: { id: cls.f3n }, data: { capacity: 1 } });
    const r = await confirm(runId);
    expect(r.status).toBe(409);
    expect(r.json.message).toContain('Form 3 North would have 2 students (capacity 1)');
    expect(await prisma.enrollment.count({ where: { termId: term1_2027 } })).toBe(0);
    expect(await prisma.schoolClass.count({ where: { schoolId: A.schoolId } })).toBe(classesBefore); // classes made inside the transaction were rolled back
    expect((await prisma.student.findUniqueOrThrow({ where: { id: ids.Eve } })).status).toBe('ACTIVE');
    // put the draft back to the one used in the next test
    await save([{ studentId: ids.Cara, outcome: 'REPEAT' }, { studentId: ids.Hope, outcome: 'CONTINUE_LOWER_6', toClassId: cls.f5a }, { studentId: ids.Eve, outcome: 'LEAVE', exitReason: 'TRANSFER' }, { studentId: ids.Anna, outcome: 'MOVE_STREAM', toClassId: cls.f2e }]);
  });

  it('creates the Term 1 enrollments, ends Term 3, sets the leavers, and audits every student plus a summary, all at once', async () => {
    runId = (await prisma.promotionRun.findFirstOrThrow({ where: { schoolId: A.schoolId, status: 'DRAFT' } })).id;
    const r = await confirm(runId, { acknowledgeFull: true });
    expect(r.status, r.text).toBe(200);
    expect(r.json.data).toMatchObject({ students: 12, leavers: 3 });

    const term1 = async (key: string) => prisma.enrollment.findUnique({ where: { studentId_termId: { studentId: ids[key]!, termId: term1_2027 } }, include: { class: true } });
    const term3 = async (key: string) => prisma.enrollment.findUniqueOrThrow({ where: { studentId_termId: { studentId: ids[key]!, termId: A.termId } } });
    expect((await term1('Anna'))!.class.name).toBe('Form 2 East'); // moved to another stream
    expect((await term1('Ben'))!.class.name).toBe('Form 2 East');
    expect((await term1('Cara'))!.class.name).toBe('Form 2 East'); // repeated
    expect((await term1('Dan'))!.class.name).toBe('Form 4 North'); // made on confirmation
    expect((await term1('Hope'))!.class.name).toBe('Form 5 Arts'); // continued to Lower 6
    expect((await term1('Ivy'))!.class.name).toBe('Form 6 Arts');
    expect((await term1('Kate'))!.class.name).toBe('Form 3 East');
    for (const gone of ['Eve', 'Gift', 'Joe']) expect(await term1(gone), gone).toBeNull();
    expect((await term1('Anna'))).toMatchObject({ status: 'ACTIVE', startDate: new Date('2027-01-12') });

    expect(await term3('Anna')).toMatchObject({ status: 'PROMOTED' });
    expect(await term3('Cara')).toMatchObject({ status: 'REPEATED' });
    expect(await term3('Gift')).toMatchObject({ status: 'GRADUATED' });
    expect(await term3('Eve')).toMatchObject({ status: 'TRANSFERRED_OUT' });
    expect((await term3('Anna')).endDate!.toISOString().slice(0, 10)).toBe('2026-12-04');

    const status = async (key: string) => (await prisma.student.findUniqueOrThrow({ where: { id: ids[key]! } })).status;
    expect(await status('Gift')).toBe('GRADUATED');
    expect(await status('Joe')).toBe('GRADUATED');
    expect(await status('Eve')).toBe('TRANSFERRED');
    expect(await status('Anna')).toBe('ACTIVE');
    expect(await status('Kate')).toBe('SUSPENDED'); // carried over
    const exits = await prisma.studentExit.findMany({ where: { studentId: { in: [ids.Gift!, ids.Joe!, ids.Eve!] }, state: 'COMPLETED' } });
    const exitOf = (key: string) => exits.find((x) => x.studentId === ids[key])!;
    expect(exitOf('Joe')).toMatchObject({ reason: 'COMPLETED_A_LEVEL', approvedById: A.users.ADMIN.id });
    expect(exitOf('Gift')).toMatchObject({ reason: 'COMPLETED_O_LEVEL', resultingStatus: 'GRADUATED' });
    expect(exitOf('Eve')).toMatchObject({ reason: 'TRANSFER', resultingStatus: 'TRANSFERRED' });
    expect((await prisma.alumnus.findMany({ where: { schoolId: A.schoolId } })).map((a) => [a.studentId, a.yearLeft, a.lastClass]).sort()).toEqual([[ids.Gift, 2026, 'Form 4 North'], [ids.Joe, 2026, 'Form 6 Arts']].sort());

    const run = await prisma.promotionRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({ status: 'CONFIRMED', approvedById: A.users.ADMIN.id });
    expect((run.lines as unknown[]).length).toBe(12); // the full record is kept
    const audits = await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: { in: ['PROMOTE_STUDENT', 'REPEAT_STUDENT', 'GRADUATE_STUDENT', 'TRANSFER_OUT_STUDENT'] }, entityType: 'Student' } });
    expect(audits).toHaveLength(12);
    expect(audits.find((a) => a.entityId === ids.Cara)).toMatchObject({ action: 'REPEAT_STUDENT' });
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'CONFIRM_PROMOTION', entityId: runId } })).toBe(1);
  });

  it('is done once: the year cannot be promoted again', async () => {
    expect((await confirm(runId, { acknowledgeFull: true })).status).toBe(409);
    expect((await save([{ studentId: ids.Anna, outcome: 'REPEAT' }])).status).toBe(409);
    expect((await state()).json.data.promotion).toBeNull(); // nothing left to promote
    const named = (await state(A.users.ADMIN, `?fromYearId=${year2026}`)).json.data.promotion;
    expect(named.confirmed).toMatchObject({ approvedBy: A.users.ADMIN.fullName });
  });

  it('leaves the new year ready to open: no student is without a decision', async () => {
    const { openTerm } = await import('@/lib/academic/terms');
    await openTerm(A.schoolId, A.users.ADMIN.id, term1_2027);
    const open = await prisma.student.findMany({ where: { schoolId: A.schoolId, status: { in: ['ACTIVE', 'SUSPENDED'] } }, select: { id: true, currentClassId: true } });
    for (const s of open) {
      const rows = await prisma.enrollment.findMany({ where: { studentId: s.id, termId: term1_2027 } });
      expect(rows, s.id).toHaveLength(1);
      expect(rows[0]!.classId).toBe(s.currentClassId);
    }
  });

  it('gives a report of the confirmed promotion as a PDF', async () => {
    const r = await call('students/promotion/[runId]/report', 'GET', { as: A.users.ADMIN, params: { runId } });
    expect(r.status).toBe(200);
    expect(r.response.headers.get('content-type')).toBe('application/pdf');
    expect(r.text.startsWith('%PDF')).toBe(true);
    expect((await call('students/promotion/[runId]/report', 'GET', { as: A.users.BURSAR, params: { runId } })).status).toBe(403);
    expect((await call('students/promotion/[runId]/report', 'GET', { as: B.users.ADMIN, params: { runId } })).status).toBe(404);
  });
});

describe('a draft that is not finished', () => {
  it('cannot be turned into a report', async () => {
    const run = await prisma.promotionRun.create({ data: { schoolId: A.schoolId, fromYearId: year2026, toYearId: (await prisma.academicYear.findFirstOrThrow({ where: { schoolId: A.schoolId, year: 2027 } })).id, status: 'DRAFT', lines: [], createdById: A.users.ADMIN.id } });
    expect((await call('students/promotion/[runId]/report', 'GET', { as: A.users.ADMIN, params: { runId: run.id } })).status).toBe(409);
  });
});

// @vitest-environment node
// Departments, the school's own subject list (with Head approval), subject combinations, each student's subjects and
// teaching groups: who may do what, the rules, and that every change is in the audit log.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { NOW, addTeacher, assign, buildWorld, students, type World } from '../helpers/academics';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let W: World;
let prisma: typeof import('@/lib/prisma').prisma;
let f2: string[];
let f3: string[];

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  W = await buildWorld(prisma, A);
  f2 = await students(prisma, A, W.f2East, 4, 'Two');
  f3 = await students(prisma, A, W.f3North, 4, 'Three');
}, 180_000);

afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await t.stop();
});

const admin = () => A.operator!;
const teacher = () => A.users.TEACHER;
const audit = (action: string, entityType?: string) => prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: action as never, ...(entityType ? { entityType } : {}) } });

describe('departments', () => {
  it('are made by someone who may manage subjects, and a head of department gets the HOD role for that department only', async () => {
    const hod = await addTeacher(prisma, A, 'Mrs Head Of Dept');
    const r = await call('academics/departments', 'POST', { as: admin(), body: { name: 'Technical and Vocational', hodUserId: hod } });
    expect(r.status).toBe(201);
    const id = r.json.data.department.id;
    const roles = await prisma.userRole.findMany({ where: { userId: hod, scopeType: 'DEPARTMENT' }, include: { role: true } });
    expect(roles.map((x) => [x.role.key, x.scopeId])).toEqual([['HOD', id]]);
    expect((await prisma.department.findUniqueOrThrow({ where: { id } })).hodUserId).toBe(hod);
    expect((await audit('CREATE_DEPARTMENT')).length).toBe(1);

    // Changing the head moves the role.
    const other = await addTeacher(prisma, A, 'Mr New Head');
    expect((await call('academics/departments/[id]', 'PATCH', { as: admin(), params: { id }, body: { name: 'Technical and Vocational', hodUserId: other } })).status).toBe(200);
    expect(await prisma.userRole.count({ where: { userId: hod, scopeType: 'DEPARTMENT' } })).toBe(0);
    expect(await prisma.userRole.count({ where: { userId: other, scopeType: 'DEPARTMENT', scopeId: id } })).toBe(1);
    expect((await audit('UPDATE_DEPARTMENT')).length).toBe(1);
  });

  it('cannot share a name, and cannot be deleted while they hold subjects', async () => {
    expect((await call('academics/departments', 'POST', { as: admin(), body: { name: 'sciences' } })).json.message).toMatch(/already a department called Sciences/);
    const r = await call('academics/departments/[id]', 'DELETE', { as: admin(), params: { id: W.dept.sciences } });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/still has \d+ subjects/);
    const empty = await call('academics/departments', 'POST', { as: admin(), body: { name: 'Empty' } });
    expect((await call('academics/departments/[id]', 'DELETE', { as: admin(), params: { id: empty.json.data.department.id } })).status).toBe(200);
  });

  it('are closed to a teacher, to another school and to visitors', async () => {
    expect((await call('academics/departments', 'POST', { as: teacher(), body: { name: 'Mine' } })).status).toBe(403);
    expect((await call('academics/departments', 'POST', { as: null, body: { name: 'Mine' } })).status).toBe(401);
    expect((await call('academics/departments/[id]', 'PATCH', { as: B.operator!, params: { id: W.dept.sciences }, body: { name: 'Hacked' } })).status).toBe(404);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: W.dept.sciences } })).name).toBe('Sciences');
  });
});

describe('the subject list', () => {
  const body = (o: object = {}) => ({
    name: 'Shona', shortName: 'Shona', code: 'sho', departmentId: W.dept.languages, examBoard: 'ZIMSEC', isPractical: false, colour: '#7C3AED',
    levels: [{ levelId: W.form1, type: 'CORE' }, { levelId: W.form2, type: 'CORE' }], ...o,
  });

  it('keeps every field the brief names, and teachers can read the list but not change it', async () => {
    const r = await call('academics/subjects', 'POST', { as: admin(), body: body({ zimsecCode: '4003', cambridgeCode: null }) });
    expect(r.status).toBe(201);
    expect(r.json.data.applied).toBe(true);
    const s = await prisma.subject.findUniqueOrThrow({ where: { id: r.json.data.subjectId }, include: { levels: true } });
    expect(s).toMatchObject({ name: 'Shona', shortName: 'Shona', code: 'SHO', zimsecCode: '4003', examBoard: 'ZIMSEC', isPractical: false, active: true, colour: '#7C3AED' });
    expect(s.levels.map((l) => l.type).sort()).toEqual(['CORE', 'CORE']);
    expect((await call('academics/subjects', 'GET', { as: teacher() })).status).toBe(200);
    expect((await call('academics/subjects', 'POST', { as: teacher(), body: body({ name: 'Ndebele', code: 'NDE' }) })).status).toBe(403);
    const audited = await audit('CREATE_SUBJECT');
    expect(audited.some((a) => a.entityId === s.id && /approved by/.test(a.detail ?? ''))).toBe(true);
  });

  it('refuses a repeated code or name, a missing department and a form that is not there', async () => {
    expect((await call('academics/subjects', 'POST', { as: admin(), body: body({ name: 'Shona Two' }) })).json.message).toMatch(/school code SHO is already used by Shona/);
    expect((await call('academics/subjects', 'POST', { as: admin(), body: body({ code: 'SH2' }) })).json.message).toMatch(/already a subject called Shona/);
    expect((await call('academics/subjects', 'POST', { as: admin(), body: body({ name: 'X Sub', code: 'XSU', departmentId: 'nope' }) })).status).toBe(404);
    expect((await call('academics/subjects', 'POST', { as: admin(), body: body({ name: 'X Sub', code: 'XSU', levels: [{ levelId: B.levelId, type: 'CORE' }] }) })).status).toBe(404);
    expect((await call('academics/subjects', 'POST', { as: admin(), body: body({ name: 'X Sub', code: 'XSU', levels: [] }) })).status).toBe(422);
  });

  it('allows Cambridge only for a school that offers it', async () => {
    expect((await call('academics/subjects', 'POST', { as: admin(), body: body({ name: 'IGCSE Maths', code: 'IGM', examBoard: 'CAMBRIDGE', cambridgeCode: '0580' }) })).json.message).toMatch(/does not offer Cambridge/);
    await prisma.school.update({ where: { id: A.schoolId }, data: { offersCambridge: true } });
    expect((await call('academics/subjects', 'POST', { as: admin(), body: body({ name: 'IGCSE Maths', code: 'IGM', examBoard: 'CAMBRIDGE', cambridgeCode: '0580' }) })).status).toBe(201);
    await prisma.school.update({ where: { id: A.schoolId }, data: { offersCambridge: false } });
  });

  it('takes a change from someone who cannot approve and holds it until the Head approves', async () => {
    await grantPermission(prisma, A.schoolId, 'HEAD', 'academics.subjects.manage');
    await grantPermission(prisma, A.schoolId, 'HEAD', 'academics.subjects.approve');
    const deputy = await addTeacher(prisma, A, 'Deputy Dee', ['DEPUTY_HEAD']);
    await grantPermission(prisma, A.schoolId, 'DEPUTY_HEAD', 'academics.subjects.manage');
    const dep = { id: deputy, email: 'd@x', schoolId: A.schoolId, role: 'TEACHER' as const, fullName: 'Deputy Dee' };

    const r = await call('academics/subjects', 'POST', { as: dep, body: body({ name: 'Ndebele', code: 'NDE', shortName: 'Ndebele' }) });
    expect(r.status).toBe(201);
    expect(r.json.data).toMatchObject({ applied: false, subjectId: null });
    expect(await prisma.subject.count({ where: { schoolId: A.schoolId, code: 'NDE' } })).toBe(0);
    const pending = await call('academics/subjects/changes', 'GET', { as: admin() });
    expect(pending.json.data.changes).toHaveLength(1);
    expect(pending.json.data.changes[0]).toMatchObject({ kind: 'CREATE', status: 'PENDING', requestedBy: 'Deputy Dee' });
    // The approvers were told; the requester was not.
    const told = await prisma.notification.findMany({ where: { schoolId: A.schoolId, type: 'SUBJECT_CHANGE' } });
    expect(told.map((n) => n.userId)).toContain(A.users.HEAD.id);
    expect(told.map((n) => n.userId)).not.toContain(deputy);
    expect((await audit('REQUEST_SUBJECT_CHANGE')).length).toBeGreaterThan(0);

    // Not allowed to approve: the deputy lacks the permission.
    const id = pending.json.data.changes[0].id;
    expect((await call('academics/subjects/changes/[id]', 'POST', { as: dep, params: { id }, body: { decision: 'APPROVE' } })).status).toBe(403);
    // A rejection needs a reason.
    expect((await call('academics/subjects/changes/[id]', 'POST', { as: A.users.HEAD, params: { id }, body: { decision: 'REJECT' } })).status).toBe(422);
    const ok = await call('academics/subjects/changes/[id]', 'POST', { as: A.users.HEAD, params: { id }, body: { decision: 'APPROVE' } });
    expect(ok.status).toBe(200);
    const created = await prisma.subject.findFirstOrThrow({ where: { schoolId: A.schoolId, code: 'NDE' } });
    const decided = await prisma.subjectChange.findUniqueOrThrow({ where: { id } });
    expect(decided).toMatchObject({ status: 'APPROVED', decidedById: A.users.HEAD.id, subjectId: created.id });
    expect((await call('academics/subjects/changes/[id]', 'POST', { as: A.users.HEAD, params: { id }, body: { decision: 'APPROVE' } })).status).toBe(409);
    expect((await audit('UPDATE_SUBJECT')).concat(await audit('CREATE_SUBJECT')).some((a) => a.entityId === created.id && /approved by School A HEAD/.test(a.detail ?? ''))).toBe(true);
  });

  it('records a rejection with the reason and does not change the list', async () => {
    const dep = await prisma.user.findFirstOrThrow({ where: { schoolId: A.schoolId, fullName: 'Deputy Dee' } });
    const as = { id: dep.id, email: dep.email, schoolId: A.schoolId, role: 'TEACHER' as const, fullName: dep.fullName };
    await call('academics/subjects', 'POST', { as, body: body({ name: 'Latin', code: 'LAT', shortName: 'Latin' }) });
    const id = (await call('academics/subjects/changes', 'GET', { as: admin() })).json.data.changes[0].id;
    expect((await call('academics/subjects/changes/[id]', 'POST', { as: A.users.HEAD, params: { id }, body: { decision: 'REJECT', note: 'We do not teach Latin' } })).status).toBe(200);
    expect(await prisma.subject.count({ where: { schoolId: A.schoolId, code: 'LAT' } })).toBe(0);
    expect(await prisma.subjectChange.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'REJECTED', decisionNote: 'We do not teach Latin' });
  });

  it('keeps an inactive subject and its history, but it cannot be assigned', async () => {
    const hist = W.subjects.history;
    await assign(prisma, A, { teacherId: W.teachers.chikore, subjectId: hist, classId: W.f2East });
    const r = await call('academics/subjects/[id]/active', 'POST', { as: admin(), params: { id: hist }, body: { active: false } });
    expect(r.status).toBe(200);
    const s = await prisma.subject.findUniqueOrThrow({ where: { id: hist } });
    expect(s.active).toBe(false);
    expect(await prisma.teacherAssignment.count({ where: { subjectId: hist } })).toBe(1); // history stays
    const a = await call('academics/assignments', 'POST', { as: admin(), body: { teacherId: W.teachers.moyo, subjectId: hist, classId: W.f3North, periodsPerWeek: 3 } });
    expect(a.status).toBe(409);
    expect(a.json.message).toMatch(/History is inactive/);
    await call('academics/subjects/[id]/active', 'POST', { as: admin(), params: { id: hist }, body: { active: true } });
    await prisma.teacherAssignment.deleteMany({ where: { subjectId: hist } });
  });

  it('will not stop a form offering a subject that is still taught there', async () => {
    const geo = W.subjects.geography;
    await assign(prisma, A, { teacherId: W.teachers.moyo, subjectId: geo, classId: W.f2East });
    const s = await prisma.subject.findUniqueOrThrow({ where: { id: geo }, include: { levels: true } });
    const levels = s.levels.filter((l) => l.levelId !== W.form2).map((l) => ({ levelId: l.levelId, type: l.type }));
    const r = await call('academics/subjects/[id]', 'PATCH', { as: admin(), params: { id: geo }, body: body({ name: s.name, shortName: s.shortName, code: s.code, departmentId: s.departmentId, examBoard: s.examBoard, levels }) });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/still taught in Form 2 East/);
    await prisma.teacherAssignment.deleteMany({ where: { subjectId: geo } });
  });

  it('starts a new school from an editable starter list, skipping what exists', async () => {
    const list = await call('academics/subjects/starter', 'GET', { as: admin() });
    expect(list.status).toBe(200);
    expect(list.json.data.subjects.length).toBeGreaterThan(20);
    const pick = list.json.data.subjects.filter((s: { code: string }) => ['ENG', 'HER', 'AGR', 'MAT'].includes(s.code));
    pick[0].shortName = 'Eng Lang'; // the school edits the list before saving
    const r = await call('academics/subjects/starter', 'POST', { as: admin(), body: { subjects: pick } });
    expect(r.status).toBe(201);
    // ENG and MAT exist already (different codes but same names), so only Heritage Studies and Agriculture are new.
    expect(r.json.data.created).toBe(2);
    expect(r.json.data.skipped).toBe(2);
    expect(await prisma.department.count({ where: { schoolId: A.schoolId, name: 'Technical and Vocational' } })).toBe(1);
    const her = await prisma.subject.findFirstOrThrow({ where: { schoolId: A.schoolId, code: 'HER' }, include: { levels: true } });
    expect(her.levels.length).toBe(3); // Forms 1-3 exist in this school (the starter list says Forms 1-4)
    expect((await call('academics/subjects/starter', 'GET', { as: teacher() })).status).toBe(403);
    expect((await audit('LOAD_STARTER_SUBJECTS')).length).toBe(1);
  });
});

describe("each student's subjects", () => {
  it('give core subjects automatically from the form and electives by choice', async () => {
    const sync = await call('academics/student-subjects/sync-core', 'POST', { as: admin(), body: { classId: W.f2East } });
    expect(sync.status).toBe(200);
    const core = await prisma.studentSubject.findMany({ where: { studentId: f2[0], termId: A.termId } });
    const expected = await prisma.subjectLevel.findMany({ where: { schoolId: A.schoolId, levelId: W.form2, type: 'CORE', subject: { active: true } }, include: { subject: true } });
    expect(core.map((c) => c.subjectId).sort()).toEqual(expected.map((e) => e.subjectId).sort());
    expect(expected.map((e) => e.subject.name)).toEqual(expect.arrayContaining(['Combined Science', 'English Language', 'Mathematics', 'Shona']));
    expect(core.every((c) => c.source === 'CORE')).toBe(true);
    expect((await call('academics/student-subjects/sync-core', 'POST', { as: admin(), body: { classId: W.f2East } })).json.data.added).toBe(0); // safe to run again
  });

  it('are chosen in a grid, and a student only gets electives the form offers', async () => {
    const put = (changes: object[]) => call('academics/student-subjects', 'PUT', { as: admin(), body: { classId: W.f2East, changes } });
    const ok = await put([{ studentId: f2[0], subjectIds: [W.subjects.geography, W.subjects.history] }, { studentId: f2[1], subjectIds: [W.subjects.history] }]);
    expect(ok.status).toBe(200);
    expect(ok.json.data).toMatchObject({ changedStudents: 2, added: 3 });
    const rows = await prisma.studentSubject.findMany({ where: { studentId: f2[0], source: 'CHOSEN' } });
    expect(rows.map((r) => r.subjectId).sort()).toEqual([W.subjects.geography, W.subjects.history].sort());
    // Accounts is only offered in Form 3.
    const bad = await put([{ studentId: f2[2], subjectIds: [W.subjects.accounts] }]);
    expect(bad.status).toBe(422);
    expect(bad.json.message).toMatch(/not offered in Form 2/);
    // A student from another class is refused.
    expect((await put([{ studentId: f3[0], subjectIds: [W.subjects.history] }])).status).toBe(404);
    expect((await audit('ASSIGN_STUDENT_SUBJECTS')).length).toBeGreaterThan(1);
  });

  it('warn about too few and too many subjects but still save', async () => {
    const grid = await call('academics/student-subjects', 'GET', { as: admin(), query: `?classId=${W.f2East}` });
    expect(grid.status).toBe(200);
    expect(grid.json.data.limits).toEqual({ min: 8, max: 10 });
    const s0 = grid.json.data.students.find((s: { id: string }) => s.id === f2[0]);
    const coreCount = await prisma.subjectLevel.count({ where: { schoolId: A.schoolId, levelId: W.form2, type: 'CORE', subject: { active: true } } });
    expect(s0.count).toBe(coreCount + 2); // the core subjects and two electives
    expect(s0.warnings.map((w: { code: string }) => w.code)).toEqual(coreCount + 2 < 8 ? ['TOO_FEW'] : []);
    await prisma.academicsSettings.update({ where: { schoolId: A.schoolId }, data: { minSubjectsOLevel: 2, maxSubjectsOLevel: coreCount } });
    const again = await call('academics/student-subjects', 'GET', { as: admin(), query: `?classId=${W.f2East}` });
    expect(again.json.data.students.find((s: { id: string }) => s.id === f2[0]).warnings.map((w: { code: string }) => w.code)).toEqual(['TOO_MANY']);
    const put = await call('academics/student-subjects', 'PUT', { as: admin(), body: { classId: W.f2East, changes: [{ studentId: f2[0], subjectIds: [W.subjects.geography] }] } });
    expect(put.status).toBe(200);
    expect(Array.isArray(put.json.data.warnings)).toBe(true);
    expect(await prisma.studentSubject.count({ where: { studentId: f2[0], subjectId: W.subjects.geography } })).toBe(1);
    await prisma.academicsSettings.update({ where: { schoolId: A.schoolId }, data: { minSubjectsOLevel: 8, maxSubjectsOLevel: 10 } });
  });

  it('are given in one step by applying a combination', async () => {
    const make = await call('academics/combinations', 'POST', { as: admin(), body: { name: 'Humanities', levelId: W.form2, subjectIds: [W.subjects.geography, W.subjects.history], classIds: [W.f2East] } });
    expect(make.status).toBe(201);
    const combo = make.json.data.id;
    const r = await call('academics/student-subjects/apply-combination', 'POST', { as: admin(), body: { classId: W.f2East, combinationId: combo, studentIds: [f2[2], f2[3], f2[0]] } });
    expect(r.status).toBe(200);
    expect(r.json.data.applied).toBe(3);
    for (const id of [f2[2], f2[3]]) {
      const rows = await prisma.studentSubject.findMany({ where: { studentId: id, source: 'COMBINATION' } });
      expect(rows.map((x) => x.subjectId).sort()).toEqual([W.subjects.geography, W.subjects.history].sort());
    }
    // f2[0] had Geography by choice; it now belongs to the combination, and History was added.
    expect((await prisma.studentSubject.findMany({ where: { studentId: f2[0], source: { not: 'CORE' } } })).every((x) => x.source === 'COMBINATION')).toBe(true);
    // Core subjects were never touched.
    expect(await prisma.studentSubject.count({ where: { studentId: f2[2], source: 'CORE' } })).toBe(await prisma.subjectLevel.count({ where: { schoolId: A.schoolId, levelId: W.form2, type: 'CORE', subject: { active: true } } }));
  });

  it('refuse a combination for another form, or one not linked to the class', async () => {
    const f3combo = (await call('academics/combinations', 'POST', { as: admin(), body: { name: 'Commerce', levelId: W.form3, subjectIds: [W.subjects.accounts], classIds: [] } })).json.data.id;
    const wrongForm = await call('academics/student-subjects/apply-combination', 'POST', { as: admin(), body: { classId: W.f2East, combinationId: f3combo, studentIds: [f2[0]] } });
    expect(wrongForm.status).toBe(422);
    expect(wrongForm.json.message).toMatch(/another form/);
    const west = await prisma.schoolClass.create({ data: { schoolId: A.schoolId, name: 'Form 2 West', levelId: W.form2, stream: 'West' } });
    const westOnly = (await call('academics/combinations', 'POST', { as: admin(), body: { name: 'West only', levelId: W.form2, subjectIds: [W.subjects.history], classIds: [west.id] } })).json.data.id;
    const unlinked = await call('academics/student-subjects/apply-combination', 'POST', { as: admin(), body: { classId: W.f2East, combinationId: westOnly, studentIds: [f2[0]] } });
    expect(unlinked.status).toBe(422);
    expect(unlinked.json.message).toMatch(/not linked to Form 2 East/);
    // A subject that the form does not offer cannot go in its combination.
    const bad = await call('academics/combinations', 'POST', { as: admin(), body: { name: 'Bad', levelId: W.form2, subjectIds: [W.subjects.accounts], classIds: [] } });
    expect(bad.status).toBe(422);
    // A class of another form cannot be linked.
    const badClass = await call('academics/combinations', 'POST', { as: admin(), body: { name: 'Bad 2', levelId: W.form2, subjectIds: [W.subjects.history], classIds: [W.f3North] } });
    expect(badClass.status).toBe(422);
  });

  it('are closed to a teacher who is not assigned, and read-only for a closed term', async () => {
    expect((await call('academics/student-subjects', 'PUT', { as: teacher(), body: { classId: W.f2East, changes: [{ studentId: f2[0], subjectIds: [] }] } })).status).toBe(403);
    const closed = await prisma.academicTerm.create({ data: { schoolId: A.schoolId, academicYearId: A.yearId, termNumber: 2, name: 'Term 2 2026', startDate: new Date('2026-05-01'), endDate: new Date('2026-08-01'), status: 'CLOSED' } });
    const r = await call('academics/student-subjects', 'PUT', { as: admin(), body: { termId: closed.id, classId: W.f2East, changes: [{ studentId: f2[0], subjectIds: [] }] } });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/Term 2 2026 is closed/);
    // The database refuses it too, whatever the code does.
    await expect(
      t.pg.exec(`INSERT INTO "StudentSubject" (id, "schoolId", "studentId", "subjectId", "termId", "updatedAt") VALUES ('x1', '${A.schoolId}', '${f2[0]}', '${W.subjects.maths}', '${closed.id}', now())`),
    ).rejects.toThrow(/Term 2 2026 is closed/);
  });
});

describe('teaching groups', () => {
  let accountants: string[];
  it('are filled from the students who take the subject, across classes', async () => {
    const north = f3; // Form 3 North
    const south = await prisma.schoolClass.create({ data: { schoolId: A.schoolId, name: 'Form 3 South', levelId: W.form3, stream: 'South' } });
    const southStudents = await students(prisma, A, south.id, 2, 'South');
    accountants = [north[0]!, north[1]!, southStudents[0]!];
    await call('academics/student-subjects/sync-core', 'POST', { as: admin(), body: {} });
    for (const [classId, ids] of [[W.f3North, [north[0]!, north[1]!]], [south.id, [southStudents[0]!]]] as const) {
      await call('academics/student-subjects', 'PUT', { as: admin(), body: { classId, changes: ids.map((studentId) => ({ studentId, subjectIds: [W.subjects.accounts] })) } });
    }
    const r = await call('academics/teaching-groups', 'POST', { as: admin(), body: { name: 'Form 3 Accounts', subjectId: W.subjects.accounts, levelId: W.form3 } });
    expect(r.status).toBe(201);
    expect(r.json.data.students).toBe(3);
    const list = await call('academics/teaching-groups', 'GET', { as: admin() });
    const g = list.json.data.groups[0];
    expect(g).toMatchObject({ name: 'Form 3 Accounts', students: 3 });
    expect(g.classes.map((c: { name: string; count: number }) => `${c.name}:${c.count}`).sort()).toEqual(['Form 3 North:2', 'Form 3 South:1']);
  });

  it('refuse a student who does not take the subject, a core subject and a second group for the same subject', async () => {
    const g = await prisma.teachingGroup.findFirstOrThrow({ where: { schoolId: A.schoolId, name: 'Form 3 Accounts' } });
    const bad = await call('academics/teaching-groups/[id]', 'PATCH', { as: admin(), params: { id: g.id }, body: { name: g.name, subjectId: g.subjectId, levelId: g.levelId, studentIds: [f3[3]] } });
    expect(bad.status).toBe(422);
    expect(bad.json.message).toMatch(/does not take Accounts/);
    const core = await call('academics/teaching-groups', 'POST', { as: admin(), body: { name: 'Form 3 Maths', subjectId: W.subjects.maths, levelId: W.form3 } });
    expect(core.status).toBe(422);
    expect(core.json.message).toMatch(/core subject/);
    const dup = await call('academics/teaching-groups', 'POST', { as: admin(), body: { name: 'Accounts B', subjectId: W.subjects.accounts, levelId: W.form3 } });
    expect(dup.status).toBe(409);
    expect(dup.json.message).toMatch(/is already in Form 3 Accounts/);
  });

  it('follow a student who drops the subject, and can be refreshed', async () => {
    const g = await prisma.teachingGroup.findFirstOrThrow({ where: { schoolId: A.schoolId, name: 'Form 3 Accounts' } });
    await call('academics/student-subjects', 'PUT', { as: admin(), body: { classId: W.f3North, changes: [{ studentId: f3[1], subjectIds: [] }] } });
    expect(await prisma.teachingGroupStudent.count({ where: { groupId: g.id } })).toBe(2);
    await call('academics/student-subjects', 'PUT', { as: admin(), body: { classId: W.f3North, changes: [{ studentId: f3[2], subjectIds: [W.subjects.accounts] }] } });
    const r = await call('academics/teaching-groups/[id]/sync', 'POST', { as: admin(), params: { id: g.id } });
    expect(r.json.data).toEqual({ added: 1, removed: 0 });
    expect(await prisma.teachingGroupStudent.count({ where: { groupId: g.id } })).toBe(3);
    expect(accountants).toHaveLength(3);
  });

  it('cannot be deleted once a teacher has been assigned', async () => {
    const g = await prisma.teachingGroup.findFirstOrThrow({ where: { schoolId: A.schoolId, name: 'Form 3 Accounts' } });
    await assign(prisma, A, { teacherId: W.teachers.dube, subjectId: W.subjects.accounts, groupId: g.id });
    const r = await call('academics/teaching-groups/[id]', 'DELETE', { as: admin(), params: { id: g.id } });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/has a teacher assigned/);
  });
});

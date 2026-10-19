// @vitest-environment node
// The syllabus (topic tree, CSV import, templates), schemes of work (weeks from the term dates, copy from last year,
// Draft/Submitted/Approved/Returned), the record of work with coverage, the Friday reminder, and optional lesson plans.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { NOW, TODAY, addTeacher, assign, buildWorld, day, sessionFor, type World } from '../helpers/academics';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let W: World;
let prisma: typeof import('@/lib/prisma').prisma;
let hod: Awaited<ReturnType<typeof sessionFor>>;
let chikore: Awaited<ReturnType<typeof sessionFor>>;
let moyo: Awaited<ReturnType<typeof sessionFor>>;
let asg: { maths: string; eng: string };

const admin = () => A.users.ADMIN;
const audit = (action: string) => prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: action as never } });
const topic = (body: object, as = admin()) => call('academics/syllabus', 'POST', { as, body: { subjectId: W.subjects.maths, levelId: W.form1, ...body } });
const tree = async (subjectId = W.subjects.maths, levelId = W.form1) => (await call('academics/syllabus', 'GET', { as: admin(), query: `?subjectId=${subjectId}&levelId=${levelId}` })).json.data;
let ids: Record<string, string> = {};

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  W = await buildWorld(prisma, A);
  await prisma.calendarEvent.create({ data: { schoolId: A.schoolId, title: 'Test holiday', kind: 'PUBLIC_HOLIDAY', startDate: new Date('2026-10-09'), endDate: new Date('2026-10-09'), createdById: admin().id } });
  // The head of Sciences (maths, science, physics are Sciences) is a HOD with the scheme and syllabus permissions.
  const hodId = await addTeacher(prisma, A, 'Mrs Sciences Head', ['HOD']);
  await prisma.department.update({ where: { id: W.dept.sciences }, data: { hodUserId: hodId } });
  for (const k of ['academics.schemes.view', 'academics.schemes.approve', 'academics.syllabus.manage', 'academics.analytics.view']) await grantPermission(prisma, A.schoolId, 'HOD', k);
  hod = await sessionFor(prisma, hodId);
  chikore = await sessionFor(prisma, W.teachers.chikore);
  moyo = await sessionFor(prisma, W.teachers.moyo);
  asg = {
    maths: (await assign(prisma, A, { teacherId: W.teachers.chikore, subjectId: W.subjects.maths, classId: W.f1North, periods: 4 })).id,
    eng: (await assign(prisma, A, { teacherId: W.teachers.moyo, subjectId: W.subjects.english, classId: W.f1North, periods: 4 })).id,
  };
}, 180_000);

afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await t.stop();
});

describe('the syllabus', () => {
  it('is a tree of topics and sub-topics with learning objectives: Form 1 Mathematics > Algebra > Simultaneous equations', async () => {
    const algebra = await topic({ title: 'Algebra', objectives: 'Work with expressions and equations' });
    expect(algebra.status).toBe(201);
    ids.algebra = algebra.json.data.topic.id;
    const sim = await topic({ title: 'Simultaneous equations', parentId: ids.algebra, objectives: 'Solve two equations in two unknowns' });
    ids.sim = sim.json.data.topic.id;
    ids.linear = (await topic({ title: 'Linear equations', parentId: ids.algebra, order: 0 })).json.data.topic.id;
    ids.geometry = (await topic({ title: 'Geometry' })).json.data.topic.id;
    const d = await tree();
    expect(d.topics.map((x: { title: string }) => x.title)).toEqual(['Algebra', 'Geometry']);
    expect(d.topics[0].children.map((x: { title: string }) => x.title)).toEqual(['Linear equations', 'Simultaneous equations']);
    expect(d.topics[0].children[1].objectives).toBe('Solve two equations in two unknowns');
    expect((await audit('SAVE_SYLLABUS')).length).toBe(4);
  });

  it('keeps a topic in its own subject and form, and out of its own branch', async () => {
    expect((await topic({ title: 'Wrong parent', parentId: ids.algebra, levelId: W.form2 })).status).toBe(422);
    expect((await topic({ title: 'Not offered', subjectId: W.subjects.accounts })).status).toBe(422);
    const loop = await call('academics/syllabus/[id]', 'PATCH', { as: admin(), params: { id: ids.algebra }, body: { subjectId: W.subjects.maths, levelId: W.form1, title: 'Algebra', parentId: ids.sim } });
    expect(loop.status).toBe(422);
    expect(loop.json.message).toMatch(/cannot be put under itself/);
    expect((await topic({ title: '' })).status).toBe(422);
  });

  it('is entered by the head of the department for their own subjects only', async () => {
    expect((await topic({ title: 'By the HOD' }, hod as never)).status).toBe(201); // Maths is in Sciences
    expect((await topic({ title: 'Geography topic', subjectId: W.subjects.geography }, hod as never)).status).toBe(404); // Humanities
    expect((await call('academics/syllabus', 'POST', { as: chikore, body: { subjectId: W.subjects.maths, levelId: W.form1, title: 'Teacher topic' } })).status).toBe(403);
    // A teacher may read it (to plan from it).
    expect((await call('academics/syllabus', 'GET', { as: chikore, query: `?subjectId=${W.subjects.maths}&levelId=${W.form1}` })).status).toBe(200);
  });

  it('cannot lose a topic that has sub-topics or is used in a scheme of work', async () => {
    const withKids = await call('academics/syllabus/[id]', 'DELETE', { as: admin(), params: { id: ids.algebra } });
    expect(withKids.status).toBe(409);
    expect(withKids.json.message).toMatch(/has sub-topics/);
  });

  describe('import from CSV', () => {
    const csv = (rows: string[]) => ['subject,level,topic,sub-topic,objectives', ...rows].join('\n');
    const imp = (text: string, as = admin()) => call('academics/syllabus/import', 'POST', { as, body: { csv: text } });

    it('adds topics and sub-topics, finds subjects by name or code and forms by name or number, and updates objectives', async () => {
      const maths = (await prisma.subject.findUniqueOrThrow({ where: { id: W.subjects.maths } })).code;
      const r = await imp(csv([
        `Mathematics,Form 2,Number,,Operations with numbers`,
        `${maths},2,Number,Fractions,Add and subtract fractions`,
        `Mathematics,Form 2,Number,Decimals,`,
        `Mathematics,Form 1,Algebra,,Updated objectives for Algebra`,
      ]));
      expect(r.status).toBe(200);
      expect(r.json.data).toMatchObject({ created: 3, updated: 1, errors: [] });
      const d = await tree(W.subjects.maths, W.form2);
      expect(d.topics[0]).toMatchObject({ title: 'Number', objectives: 'Operations with numbers' });
      expect(d.topics[0].children.map((x: { title: string }) => x.title)).toEqual(['Fractions', 'Decimals']);
      expect((await tree()).topics.find((x: { title: string }) => x.title === 'Algebra').objectives).toBe('Updated objectives for Algebra');
      expect((await audit('IMPORT_SYLLABUS')).length).toBe(1);
    });

    it('imports nothing when a row is wrong, and says which', async () => {
      const before = await prisma.syllabusTopic.count({ where: { schoolId: A.schoolId } });
      const r = await imp(csv([`Mathematics,Form 1,Fine topic,,`, `Basket weaving,Form 1,X,,`, `Mathematics,Form 9,Y,,`, `Accounts,Form 1,Z,,`, `Mathematics,Form 1,,,`]));
      expect(r.json.data.created).toBe(0);
      expect(r.json.data.errors).toEqual([
        { row: 3, message: 'Subject "Basket weaving" is not in this school\'s subject list' },
        { row: 4, message: 'Form "Form 9" was not found' },
        { row: 5, message: 'Accounts is not offered in Form 1' },
        { row: 6, message: 'The topic is empty' },
      ]);
      expect(await prisma.syllabusTopic.count({ where: { schoolId: A.schoolId } })).toBe(before);
      expect((await imp('subject,level\nMathematics,Form 1')).status).toBe(422);
      expect((await imp('')).status).toBe(422);
    });

    it('is limited for a head of department to their own subjects, and closed to teachers', async () => {
      const r = await imp(csv([`Geography,Form 1,Rivers,,`]), hod as never);
      expect(r.json.data.errors[0].message).toMatch(/not in your department/);
      expect((await imp(csv([`Mathematics,Form 1,Topic,,`]), chikore as never)).status).toBe(403);
    });
  });

  describe('templates shared between schools', () => {
    it('are shared as topics only, and start another school\'s empty syllabus', async () => {
      const shared = await call('academics/syllabus/share', 'POST', { as: admin(), body: { subjectId: W.subjects.maths, levelId: W.form1, name: 'Zimbabwe Form 1 Maths' } });
      expect(shared.status).toBe(201);
      const tpl = await prisma.syllabusTemplate.findFirstOrThrow({ where: { name: 'Zimbabwe Form 1 Maths' } });
      expect(tpl).toMatchObject({ subjectName: 'Mathematics', levelOrder: 1, sharedBySchool: 'School A' });
      expect(JSON.stringify(tpl.topics)).not.toMatch(/schoolId|studentId|email/);
      // School B (its own subject list) can see and use it.
      const bSubject = await prisma.subject.findFirstOrThrow({ where: { schoolId: B.schoolId } });
      await prisma.subjectLevel.create({ data: { schoolId: B.schoolId, subjectId: bSubject.id, levelId: B.levelId, type: 'CORE' } });
      const list = await call('academics/syllabus/templates', 'GET', { as: B.users.ADMIN, query: '?subject=Mathematics&level=1' });
      expect(list.json.data.templates.map((x: { name: string }) => x.name)).toContain('Zimbabwe Form 1 Maths');
      const use = await call('academics/syllabus/templates', 'POST', { as: B.users.ADMIN, body: { templateId: tpl.id, subjectId: bSubject.id, levelId: B.levelId } });
      expect(use.status).toBe(201);
      expect(use.json.data.topics).toBeGreaterThanOrEqual(5);
      expect(await prisma.syllabusTopic.count({ where: { schoolId: B.schoolId, subjectId: bSubject.id } })).toBe(use.json.data.topics);
      // Only into an empty syllabus.
      const again = await call('academics/syllabus/templates', 'POST', { as: B.users.ADMIN, body: { templateId: tpl.id, subjectId: bSubject.id, levelId: B.levelId } });
      expect(again.status).toBe(409);
      // Nothing of school A's changed.
      expect(await prisma.syllabusTopic.count({ where: { schoolId: A.schoolId, subjectId: bSubject.id } })).toBe(0);
    });
  });
});

describe('schemes of work', () => {
  it('have one row per teaching week of the term, skipping holiday weeks', async () => {
    const r = await call('academics/schemes/[id]', 'POST', { as: chikore, params: { id: asg.maths } });
    expect(r.status).toBe(201);
    const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: A.termId } });
    const { termWeeks } = await import('@/lib/academics/school-days');
    const expected = termWeeks(term, new Map([['2026-10-09', 'Test holiday']]), false);
    expect(r.json.data.weeks).toBe(expected.length);
    const weeks = await prisma.schemeWeek.findMany({ where: { scheme: { assignmentId: asg.maths } }, orderBy: { weekNo: 'asc' } });
    expect(weeks.map((w) => w.startDate.toISOString().slice(0, 10))).toEqual(expected.map((w) => w.startDate));
    expect(weeks[0]!.weekNo).toBe(1);
    // Starting it again adds nothing.
    expect((await call('academics/schemes/[id]', 'POST', { as: chikore, params: { id: asg.maths } })).json.data.weeks).toBe(0);
  });

  it('are written only by the teacher of the assignment', async () => {
    expect((await call('academics/schemes/[id]', 'POST', { as: moyo, params: { id: asg.maths } })).status).toBe(404);
    expect((await call('academics/schemes/[id]', 'GET', { as: moyo, params: { id: asg.maths } })).status).toBe(404);
    expect((await call('academics/schemes/[id]', 'PUT', { as: moyo, params: { id: asg.maths }, body: { weeks: [{ weekNo: 1, topicIds: [] }] } })).status).toBe(404);
    expect((await call('academics/schemes/[id]', 'POST', { as: B.users.TEACHER, params: { id: asg.maths } })).status).toBe(404);
  });

  it('take topics from the syllabus of their subject and form, with objectives, activities, resources and assessment', async () => {
    const save = (weeks: object[], as = chikore) => call('academics/schemes/[id]', 'PUT', { as, params: { id: asg.maths }, body: { weeks } });
    const ok = await save([
      { weekNo: 1, topicIds: [ids.linear!], objectives: 'Solve one-step equations', activities: 'Class exercise', resources: 'Textbook p.12', assessment: 'Quiz' },
      { weekNo: 2, topicIds: [ids.sim!] },
      { weekNo: 3, topicIds: [ids.geometry!] },
    ]);
    expect(ok.status).toBe(200);
    const s = await call('academics/schemes/[id]', 'GET', { as: chikore, params: { id: asg.maths } });
    expect(s.json.data.weeks[0]).toMatchObject({ weekNo: 1, objectives: 'Solve one-step equations', activities: 'Class exercise', resources: 'Textbook p.12', assessment: 'Quiz' });
    expect(s.json.data.weeks[1].topics).toEqual([{ id: ids.sim, title: 'Simultaneous equations', parent: 'Algebra' }]);
    // A topic of another subject or form is refused, and so is a week the term does not have.
    const other = (await topic({ title: 'Number', levelId: W.form2 })).json.data.topic.id;
    expect((await save([{ weekNo: 1, topicIds: [other] }])).status).toBe(422);
    expect((await save([{ weekNo: 59, topicIds: [] }])).json.message).toMatch(/not a teaching week/);
    expect(s.json.data.scheme).toMatchObject({ status: 'DRAFT' });
    expect((await audit('SAVE_SCHEME')).length).toBeGreaterThan(1);
  });

  it('cannot be submitted with nothing planned', async () => {
    await call('academics/schemes/[id]', 'POST', { as: moyo, params: { id: asg.eng } });
    const r = await call('academics/schemes/[id]/submit', 'POST', { as: moyo, params: { id: asg.eng } });
    expect(r.status).toBe(422);
    expect(r.json.message).toMatch(/Plan at least one week/);
  });

  it('go through Submitted, Returned with a comment, and Approved', async () => {
    const sub = await call('academics/schemes/[id]/submit', 'POST', { as: chikore, params: { id: asg.maths } });
    expect(sub.status).toBe(200);
    expect((await call('academics/schemes/[id]/submit', 'POST', { as: chikore, params: { id: asg.maths } })).json.message).toMatch(/already been submitted/);
    expect((await call('academics/schemes/[id]', 'PUT', { as: chikore, params: { id: asg.maths }, body: { weeks: [{ weekNo: 1, topicIds: [] }] } })).json.message).toMatch(/has been submitted, so it cannot be changed/);
    // The head of department and the approvers were told.
    expect(await prisma.notification.count({ where: { userId: hod.id, type: 'SCHEME' } })).toBe(1);
    // A teacher cannot approve; the HOD of another department cannot; a return needs a comment.
    expect((await call('academics/schemes/[id]/decide', 'POST', { as: chikore, params: { id: asg.maths }, body: { decision: 'APPROVE' } })).status).toBe(403);
    const geoHod = await addTeacher(prisma, A, 'Mr Humanities Head', ['HOD']);
    await prisma.department.update({ where: { id: W.dept.humanities }, data: { hodUserId: geoHod } });
    expect((await call('academics/schemes/[id]/decide', 'POST', { as: await sessionFor(prisma, geoHod), params: { id: asg.maths }, body: { decision: 'APPROVE' } })).status).toBe(404);
    expect((await call('academics/schemes/[id]/decide', 'POST', { as: hod, params: { id: asg.maths }, body: { decision: 'RETURN' } })).status).toBe(422);
    const back = await call('academics/schemes/[id]/decide', 'POST', { as: hod, params: { id: asg.maths }, body: { decision: 'RETURN', comment: 'Add resources for week 2' } });
    expect(back.json.data.status).toBe('RETURNED');
    const s = (await call('academics/schemes/[id]', 'GET', { as: chikore, params: { id: asg.maths } })).json.data;
    expect(s.scheme).toMatchObject({ status: 'RETURNED', returnComment: 'Add resources for week 2' });
    expect(s.canEdit).toBe(true);
    await call('academics/schemes/[id]', 'PUT', { as: chikore, params: { id: asg.maths }, body: { weeks: [{ weekNo: 2, topicIds: [ids.sim!], resources: 'Worksheet 4' }] } });
    await call('academics/schemes/[id]/submit', 'POST', { as: chikore, params: { id: asg.maths } });
    const ok = await call('academics/schemes/[id]/decide', 'POST', { as: hod, params: { id: asg.maths }, body: { decision: 'APPROVE' } });
    expect(ok.json.data.status).toBe('APPROVED');
    expect(await prisma.schemeOfWork.findUniqueOrThrow({ where: { assignmentId: asg.maths } })).toMatchObject({ status: 'APPROVED', approvedById: hod.id });
    expect(await prisma.notification.count({ where: { userId: W.teachers.chikore, type: 'SCHEME' } })).toBe(2);
    expect((await audit('APPROVE_SCHEME')).length).toBe(1);
    expect((await audit('RETURN_SCHEME')).length).toBe(1);
    expect((await call('academics/schemes/[id]/decide', 'POST', { as: hod, params: { id: asg.maths }, body: { decision: 'APPROVE' } })).status).toBe(409);
  });

  it('are due by a date the Head sets, and the HOD sees who is late', async () => {
    expect((await call('academics/schemes/due-date', 'POST', { as: chikore, body: { termId: A.termId, dueDate: '2026-09-08' } })).status).toBe(403);
    expect((await call('academics/schemes/due-date', 'POST', { as: hod, body: { termId: A.termId, dueDate: '2027-01-01' } })).status).toBe(422);
    const set = await call('academics/schemes/due-date', 'POST', { as: hod, body: { termId: A.termId, dueDate: '2026-09-08' } });
    expect(set.json.data.schemeDueDate).toBe('2026-09-08');
    const list = await call('academics/schemes', 'GET', { as: hod });
    expect(list.status).toBe(200);
    expect(list.json.data.dueDate).toBe('2026-09-08');
    // The HOD of Sciences sees Sciences schemes only; Mrs Moyo's English scheme (Languages) is not theirs.
    expect(list.json.data.rows.map((r: { subject: string }) => r.subject)).toEqual(['Maths']);
    const all = await call('academics/schemes', 'GET', { as: admin() });
    const eng = all.json.data.rows.find((r: { subject: string }) => r.subject === 'English');
    expect(eng).toMatchObject({ status: 'DRAFT', late: true, teacher: 'Mrs Rudo Moyo' });
    expect(all.json.data.rows.find((r: { subject: string }) => r.subject === 'Maths')).toMatchObject({ status: 'APPROVED', late: false });
    // A teacher sees their own only.
    expect((await call('academics/schemes', 'GET', { as: moyo })).json.data.rows.map((r: { subject: string }) => r.subject)).toEqual(['English']);
    expect((await audit('SET_SCHEME_DUE_DATE')).length).toBe(1);
  });
});

describe('copy from last year', () => {
  // Last year's Term 1 is made when it is needed, below.
  it('refuses when there is nothing earlier to copy', async () => {
    await call('academics/schemes/[id]', 'POST', { as: moyo, params: { id: asg.eng } });
    const r = await call('academics/schemes/[id]/copy', 'POST', { as: moyo, params: { id: asg.eng }, body: {} });
    expect(r.status).toBe(404);
    expect(r.json.message).toMatch(/No scheme from an earlier year/);
  });

  it('copies the weeks when an earlier year has one', async () => {
    // Build last year's scheme while its term is not closed (a closed term refuses writes), then close it.
    const lastYear = await prisma.academicYear.create({ data: { schoolId: A.schoolId, year: 2025, startDate: new Date('2025-01-01'), endDate: new Date('2025-12-31') } });
    const old = await prisma.academicTerm.create({ data: { schoolId: A.schoolId, academicYearId: lastYear.id, termNumber: 1, name: 'Term 1 2025', startDate: new Date('2025-01-14'), endDate: new Date('2025-04-04'), status: 'PLANNED' } });
    const prev = await prisma.teacherAssignment.create({ data: { schoolId: A.schoolId, termId: old.id, teacherId: W.teachers.moyo, subjectId: W.subjects.english, classId: W.f1South, periodsPerWeek: 4, startDate: new Date('2025-01-14') } });
    const scheme = await prisma.schemeOfWork.create({ data: { schoolId: A.schoolId, termId: old.id, assignmentId: prev.id, status: 'APPROVED', approvedById: hod.id, approvedAt: NOW } });
    const engTopic = await prisma.syllabusTopic.create({ data: { schoolId: A.schoolId, subjectId: W.subjects.english, levelId: W.form1, title: 'Comprehension' } });
    await prisma.schemeWeek.createMany({ data: [1, 2, 3].map((n) => ({ schoolId: A.schoolId, schemeId: scheme.id, weekNo: n, startDate: new Date(['2025-01-20', '2025-01-27', '2025-02-03'][n - 1]!), topicIds: n === 1 ? [engTopic.id] : [], objectives: `Week ${n} objectives` })) });
    await prisma.academicTerm.update({ where: { id: old.id }, data: { status: 'CLOSED' } });
    // This term is Term 1? The seeded term is number 1, so Term 1 2025 matches.
    const r = await call('academics/schemes/[id]/copy', 'POST', { as: moyo, params: { id: asg.eng }, body: {} });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ copied: 3, from: 'Term 1 2025' });
    const s = await call('academics/schemes/[id]', 'GET', { as: moyo, params: { id: asg.eng } });
    expect(s.json.data.weeks[0]).toMatchObject({ objectives: 'Week 1 objectives', topicIds: [engTopic.id] });
    expect(s.json.data.weeks[0].startDate).toBe('2026-09-01'); // re-dated to this term's first week
    // It will not overwrite content without being told to.
    expect((await call('academics/schemes/[id]/copy', 'POST', { as: moyo, params: { id: asg.eng }, body: {} })).status).toBe(409);
    expect((await call('academics/schemes/[id]/copy', 'POST', { as: moyo, params: { id: asg.eng }, body: { overwrite: true } })).status).toBe(200);
  });
});

describe('the record of work', () => {
  let weekIds: string[];
  it('lets the teacher tick the planned topics that were covered, add extras and note problems', async () => {
    const s = (await call('academics/schemes/[id]', 'GET', { as: chikore, params: { id: asg.maths } })).json.data;
    weekIds = s.weeks.map((w: { id: string }) => w.id);
    const w1 = s.weeks[0];
    expect(w1.topicIds).toEqual([ids.linear]);
    const r = await call('academics/schemes/records/[id]', 'PUT', { as: chikore, params: { id: w1.id }, body: { coveredTopicIds: [ids.linear], extraNotes: 'Revised fractions', problems: 'Lost 2 lessons to sports day' } });
    expect(r.json.data).toEqual({ covered: 1, planned: 1 });
    const rec = await prisma.recordOfWork.findUniqueOrThrow({ where: { schemeWeekId: w1.id } });
    expect(rec).toMatchObject({ extraNotes: 'Revised fractions', problems: 'Lost 2 lessons to sports day', recordedById: W.teachers.chikore });
    expect((await audit('RECORD_WORK')).length).toBe(1);
  });

  it('refuses topics that were not planned for the week, other teachers, and weeks that have not started', async () => {
    const planned = (await call('academics/schemes/[id]', 'GET', { as: chikore, params: { id: asg.maths } })).json.data.weeks;
    expect((await call('academics/schemes/records/[id]', 'PUT', { as: chikore, params: { id: weekIds[0]! }, body: { coveredTopicIds: [ids.geometry] } })).status).toBe(422);
    expect((await call('academics/schemes/records/[id]', 'PUT', { as: moyo, params: { id: weekIds[0]! }, body: { coveredTopicIds: [] } })).status).toBe(404);
    const future = planned.find((w: { startDate: string }) => w.startDate > TODAY);
    expect((await call('academics/schemes/records/[id]', 'PUT', { as: chikore, params: { id: future.id }, body: { coveredTopicIds: [] } })).json.message).toMatch(/has not started yet/);
  });

  it('shows coverage: planned topics covered over planned topics due by this week', async () => {
    const s = (await call('academics/schemes/[id]', 'GET', { as: chikore, params: { id: asg.maths } })).json.data;
    // Weeks 1-3 (topics: linear, simultaneous, geometry) are all in the past by 14 October; only week 1 is recorded.
    expect(s.coverage).toEqual({ due: 3, covered: 1, pct: 33 });
    const w2 = s.weeks[1];
    await call('academics/schemes/records/[id]', 'PUT', { as: chikore, params: { id: w2.id }, body: { coveredTopicIds: [ids.sim] } });
    expect((await call('academics/schemes/[id]', 'GET', { as: chikore, params: { id: asg.maths } })).json.data.coverage.pct).toBe(67);
  });

  it('is reminded on Friday when the week is not recorded, once, and never on another day', async () => {
    const { remindRecordOfWork } = await import('@/lib/academics/curriculum');
    expect(await remindRecordOfWork(A.schoolId, '2026-10-15')).toBe(0); // Thursday
    // Week of 12 October has no planned topics for Mr Chikore; plan one so there is something to record.
    const wk = await prisma.schemeWeek.findFirstOrThrow({ where: { scheme: { assignmentId: asg.maths }, startDate: new Date('2026-10-12') } });
    await prisma.schemeWeek.update({ where: { id: wk.id }, data: { topicIds: [ids.geometry!] } });
    const sent = await remindRecordOfWork(A.schoolId, '2026-10-16'); // Friday
    expect(sent).toBeGreaterThanOrEqual(1);
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: W.teachers.chikore, type: 'RECORD_OF_WORK' } })).title).toMatch(/Record this week's work: Maths, Form 1 North/);
    expect(await remindRecordOfWork(A.schoolId, '2026-10-16')).toBe(0); // not twice
    await call('academics/schemes/records/[id]', 'PUT', { as: chikore, params: { id: wk.id }, body: { coveredTopicIds: [ids.geometry] } });
  });
});

describe('lesson plans', () => {
  it('are optional: off until the school switches them on, then one form per lesson', async () => {
    const slot = await prisma.timetableSlot.findFirst({ where: { schoolId: A.schoolId } });
    const tt = slot ?? (await (async () => {
      const timetable = await prisma.timetable.create({ data: { schoolId: A.schoolId, termId: A.termId, version: 1, status: 'DRAFT' } });
      const period = await prisma.period.findFirstOrThrow({ where: { schoolId: A.schoolId, type: 'LESSON' } });
      return prisma.timetableSlot.create({ data: { schoolId: A.schoolId, timetableId: timetable.id, assignmentId: asg.maths, periodId: period.id, teacherId: W.teachers.chikore, classId: W.f1North } });
    })());
    const body = { slotId: tt.id, date: TODAY, content: { objectives: 'Solve equations', introduction: 'Recap', development: 'Worked examples', conclusion: 'Summary', evaluation: 'Exit ticket' } };
    expect((await call('academics/lesson-plans', 'PUT', { as: chikore, body })).json.message).toMatch(/switched off/);
    await prisma.academicsSettings.upsert({ where: { schoolId: A.schoolId }, update: { lessonPlans: true }, create: { schoolId: A.schoolId, lessonPlans: true } });
    const owner = tt.assignmentId === asg.maths ? chikore : await sessionFor(prisma, (await prisma.teacherAssignment.findUniqueOrThrow({ where: { id: tt.assignmentId } })).teacherId);
    const ok = await call('academics/lesson-plans', 'PUT', { as: owner, body });
    expect(ok.status).toBe(200);
    const got = await call('academics/lesson-plans', 'GET', { as: owner, query: `?slotId=${tt.id}&date=${TODAY}` });
    expect(got.json.data.plan.content.objectives).toBe('Solve equations');
    await prisma.academicsSettings.upsert({ where: { schoolId: B.schoolId }, update: { lessonPlans: true }, create: { schoolId: B.schoolId, lessonPlans: true } });
    expect((await call('academics/lesson-plans', 'PUT', { as: B.users.TEACHER, body })).status).toBe(404);
    expect((await audit('SAVE_LESSON_PLAN')).length).toBe(1);
  });
});

describe('a closed term', () => {
  it('cannot be planned, approved or recorded', async () => {
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { status: 'CLOSED' } });
    expect((await call('academics/schemes/[id]', 'PUT', { as: moyo, params: { id: asg.eng }, body: { weeks: [{ weekNo: 1, topicIds: [] }] } })).status).toBe(409);
    expect((await call('academics/schemes/records/[id]', 'PUT', { as: chikore, params: { id: (await prisma.schemeWeek.findFirstOrThrow({ where: { scheme: { assignmentId: asg.maths } } })).id }, body: { coveredTopicIds: [] } })).status).toBe(409);
    expect((await call('academics/schemes/due-date', 'POST', { as: hod, body: { termId: A.termId, dueDate: '2026-09-09' } })).status).toBe(409);
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { status: 'OPEN' } });
  });
});

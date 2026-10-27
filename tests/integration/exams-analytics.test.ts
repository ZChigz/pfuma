// @vitest-environment node
// Examination analytics: each panel's figures, who sees which panel, the filters, and the "Not yet published" label.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { actorOf, addTeacher, assign } from '../helpers/academics';
import { classWith, examWorld, takeSubject, typeIds, type ExamWorld } from '../helpers/exams';
import { addClass, addStudent } from '../helpers/students';

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let W: ExamWorld;
let prisma: typeof import('@/lib/prisma').prisma;
let an: typeof import('@/lib/exams/analytics');
type Actor = Awaited<ReturnType<typeof actorOf>>;

let head: Actor; let hod: Actor; let officer: Actor; let teacher: Actor; let classTeacher: Actor; let admin: Actor; let deputy: Actor;
let prevTermId: string;
let east: string[] = []; let west: string[] = [];
let f2West: string;
let mathsEast: string; let mathsWest: string; let engEast: string;

const fails = async (p: Promise<unknown>, status: number, match?: RegExp) => {
  try { await p; } catch (e) {
    const err = e as { status?: number; message: string };
    expect(err.status).toBe(status);
    if (match) expect(err.message).toMatch(match);
    return;
  }
  throw new Error('expected the call to fail');
};

const grade = (m: number) => (m >= 75 ? 'A' : m >= 60 ? 'B' : m >= 50 ? 'C' : m >= 40 ? 'D' : m >= 30 ? 'E' : 'U');

async function result(o: { studentId: string; subjectId: string; classId: string; assignmentId: string | null; termId: string; mark: number; published?: boolean }) {
  await prisma.subjectResult.create({ data: { schoolId: A.schoolId, studentId: o.studentId, subjectId: o.subjectId, termId: o.termId, classId: o.classId, levelId: W.form2, assignmentId: o.assignmentId, termMark: o.mark, roundedMark: Math.round(o.mark), grade: grade(Math.round(o.mark)), published: o.published ?? true, publishedAt: o.published === false ? null : new Date() } });
}
async function overall(o: { studentId: string; classId: string; termId: string; average: number; previous?: number; passes?: number; fivePasses?: boolean; published?: boolean }) {
  await prisma.termResult.create({ data: { schoolId: A.schoolId, studentId: o.studentId, termId: o.termId, classId: o.classId, totalMarks: o.average, percentage: o.average, averagePercentage: o.average, previousAverage: o.previous ?? null, subjectsPassed: o.passes ?? null, fivePassesEngMaths: o.fivePasses ?? null, published: o.published ?? true, publishedAt: new Date(), classPosition: 1, classSize: 1 } });
}

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  an = await import('@/lib/exams/analytics');
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  W = await examWorld(prisma, A);
  const e = await classWith(prisma, A, { classId: W.f2East, subjectId: W.subjects.maths, teacherId: W.teachers.chikore, count: 5, prefix: 'East' });
  east = e.kids; mathsEast = e.assignmentId;
  f2West = (await addClass(prisma, A, 'Form 2 West', { order: 2 })).id;
  const w = await classWith(prisma, A, { classId: f2West, subjectId: W.subjects.maths, teacherId: W.teachers.ncube, count: 5, prefix: 'West' });
  west = w.kids; mathsWest = w.assignmentId;
  await takeSubject(prisma, A, [...east, ...west], W.subjects.english);
  engEast = (await assign(prisma, A, { teacherId: W.teachers.moyo, subjectId: W.subjects.english, classId: W.f2East })).id;
  await prisma.classTeacher.create({ data: { schoolId: A.schoolId, classId: W.f2East, termId: A.termId, userId: W.teachers.moyo } });
  const ctRole = await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key: 'CLASS_TEACHER' } });
  await prisma.userRole.create({ data: { schoolId: A.schoolId, userId: W.teachers.moyo, roleId: ctRole.id, scopeType: 'CLASS', scopeId: W.f2East } });

  const year = await prisma.academicYear.create({ data: { schoolId: A.schoolId, year: 2025, startDate: new Date('2025-01-01'), endDate: new Date('2025-12-31') } });
  prevTermId = (await prisma.academicTerm.create({ data: { schoolId: A.schoolId, academicYearId: year.id, termNumber: 3, name: 'Term 3 2025', startDate: new Date('2025-09-01'), endDate: new Date('2025-12-10'), status: 'PLANNED' } })).id;

  // Maths: East 80 70 60 50 40 (mean 60), West 90 80 70 60 50 (mean 70); last term East 60 each, West 65 each.
  for (const [i, m] of Array.from([80, 70, 60, 50, 40].entries())) await result({ studentId: east[i]!, subjectId: W.subjects.maths, classId: W.f2East, assignmentId: mathsEast, termId: A.termId, mark: m });
  for (const [i, m] of Array.from([90, 80, 70, 60, 50].entries())) await result({ studentId: west[i]!, subjectId: W.subjects.maths, classId: f2West, assignmentId: mathsWest, termId: A.termId, mark: m });
  for (const s of east) await result({ studentId: s, subjectId: W.subjects.maths, classId: W.f2East, assignmentId: mathsEast, termId: prevTermId, mark: 60 });
  for (const s of west) await result({ studentId: s, subjectId: W.subjects.maths, classId: f2West, assignmentId: mathsWest, termId: prevTermId, mark: 65 });
  // English (East only): 55 each, one fails (30).
  for (const [i, m] of Array.from([55, 55, 55, 55, 30].entries())) await result({ studentId: east[i]!, subjectId: W.subjects.english, classId: W.f2East, assignmentId: engEast, termId: A.termId, mark: m });
  // Overall averages: East (80+55)/2 = 67.5 ... ; the fifth East student failed three subjects' worth and dropped.
  const avgs: [string, string, number, number | undefined, number, boolean][] = [
    [east[0]!, W.f2East, 67.5, 60, 2, true], [east[1]!, W.f2East, 62.5, 60, 2, true], [east[2]!, W.f2East, 57.5, 60, 2, true], [east[3]!, W.f2East, 52.5, 60, 2, true], [east[4]!, W.f2East, 35, 60, 0, false],
    [west[0]!, f2West, 90, 85, 1, true], [west[1]!, f2West, 80, 78, 1, true], [west[2]!, f2West, 70, 70, 1, true], [west[3]!, f2West, 60, 62, 1, true], [west[4]!, f2West, 50, 52, 1, true],
  ];
  for (const [studentId, classId, average, previous, passes, five] of avgs) await overall({ studentId, classId, termId: A.termId, average, previous, passes, fivePasses: five });
  for (const s of east) await overall({ studentId: s, classId: W.f2East, termId: prevTermId, average: 60 });

  head = await actorOf(prisma, A.users.HEAD.id);
  hod = await actorOf(prisma, W.hod);
  officer = await actorOf(prisma, W.examsOfficer);
  teacher = await actorOf(prisma, W.teachers.chikore);
  classTeacher = await actorOf(prisma, W.teachers.moyo);
  admin = await actorOf(prisma, A.operator!.id);
  deputy = await actorOf(prisma, await addTeacher(prisma, A, 'Mrs Deputy', ['DEPUTY_HEAD']));
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('who sees which panel', () => {
  it('gives the Head, Deputy, Owner and Administrator every panel', () => {
    for (const u of [head, deputy, admin]) expect(an.panelsFor(u)).toEqual([...an.PANELS]);
  });
  it('gives the Exams Officer the school-wide panels, including the ZIMSEC results', () => {
    expect(an.panelsFor(officer)).toEqual(expect.arrayContaining(['overview', 'grades', 'top', 'trend', 'board']));
    expect(an.panelsFor(officer)).not.toContain('atRisk');
    expect(an.panelsFor(officer)).not.toContain('valueAdded');
  });
  it('gives a HOD the subject panels, a class teacher trend and at-risk, and a teacher only the trend', () => {
    expect(an.panelsFor(hod)).toEqual(['subjects', 'teachers', 'grades', 'trend', 'top']);
    expect(an.panelsFor(classTeacher)).toEqual(['trend', 'atRisk']);
    expect(an.panelsFor(teacher)).toEqual(['trend']);
  });
  it('refuses a panel the person does not see', async () => {
    await fails(an.analyticsPanel(teacher, 'overview'), 403);
    await fails(an.analyticsPanel(hod, 'valueAdded'), 403);
    await fails(an.analyticsPanel(officer, 'atRisk'), 403);
  });
});

describe('school overview', () => {
  it('shows each form\'s average and pass rate this term against last term', async () => {
    const p = await an.analyticsPanel(head, 'overview');
    expect(p).toMatchObject({ title: 'School overview', label: 'Published results', notYetPublished: false });
    const form2 = p.rows.find((r) => r[0] === 'Form 2')!;
    // This term: maths 15 results (mean of 60 and 70 = 65) plus english 5 (mean 50): 15 results average 65 ... computed over all 15 subject results
    // maths East 80 70 60 50 40, maths West 90 80 70 60 50, english East 55 55 55 55 30 = 10 + 5 results
    const all = [80, 70, 60, 50, 40, 90, 80, 70, 60, 50, 55, 55, 55, 55, 30];
    expect(form2[1]).toBe(Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 100) / 100);
    expect(form2[2]).toBe(Math.round((all.filter((m) => m >= 50).length / all.length) * 10000) / 100);
    expect(form2[3]).toBe(62.5); // last term: five East at 60 and five West at 65
    expect(form2[5]).toBe(Math.round(((form2[1] as number) - 62.5) * 100) / 100);
  });
  it('is for the people who look after the whole school only', async () => {
    await fails(an.analyticsPanel(hod, 'overview'), 403);
  });
});

describe('subject performance and teacher comparison', () => {
  it('gives mean, pass rate, highest, lowest and the grade spread, with the classes side by side', async () => {
    const p = await an.analyticsPanel(head, 'subjects', { subjectId: W.subjects.maths });
    const all = p.rows.find((r) => r[0] === 'Mathematics' && r[2] === 'All classes')!;
    expect(all.slice(3, 8)).toEqual([10, 65, 90, 90, 40]); // students, mean, pass rate (9 of 10), highest, lowest
    expect(p.rows.find((r) => r[2] === 'Form 2 East')!.slice(3, 6)).toEqual([5, 60, 80]);
    expect(p.rows.find((r) => r[2] === 'Form 2 West')!.slice(3, 6)).toEqual([5, 70, 100]);
    expect(p.columns.filter((c) => c.startsWith('Grade '))).toEqual(['Grade A', 'Grade B', 'Grade C', 'Grade D']);
  });

  it('narrows a HOD to the subjects of their own department', async () => {
    const p = await an.analyticsPanel(hod, 'subjects');
    expect(new Set(p.rows.map((r) => r[0]))).toEqual(new Set(['Mathematics']));
  });

  it('compares classes and teachers of the same subject with the form mean', async () => {
    const p = await an.analyticsPanel(head, 'teachers', { subjectId: W.subjects.maths });
    const east = p.rows.find((r) => r[2] === 'Form 2 East')!;
    const west = p.rows.find((r) => r[2] === 'Form 2 West')!;
    expect([east[3], east[5], east[7]]).toEqual(['Mr Tendai Chikore', 60, -5]);
    expect([west[3], west[5], west[7]]).toEqual(['Ms Thando Ncube', 70, 5]);
  });

  it('can look at a single gender', async () => {
    const p = await an.analyticsPanel(head, 'subjects', { subjectId: W.subjects.maths, gender: 'F' });
    const all = p.rows.find((r) => r[2] === 'All classes')!;
    expect(all[3]).toBeLessThan(10);
    expect(all[3]).toBeGreaterThan(0);
  });
});

describe('grade distribution, top students and trend', () => {
  it('counts each grade per subject and form', async () => {
    const p = await an.analyticsPanel(officer, 'grades');
    const maths = p.rows.find((r) => r[1] === 'Mathematics')!;
    expect(p.columns.slice(0, 3)).toEqual(['Form', 'Subject', 'Students']);
    expect(maths[2]).toBe(10);
    const a = p.columns.indexOf('Grade A');
    expect(maths[a]).toBe(3); // 80, 90, 80
  });

  it('lists the top 10 by form and by subject', async () => {
    const p = await an.analyticsPanel(head, 'top');
    const overallRows = p.rows.filter((r) => r[0] === 'Form 2: overall');
    expect(overallRows).toHaveLength(10);
    expect(overallRows[0]!.slice(1)).toEqual([1, expect.stringContaining('West'), 'Form 2 West', 90]);
    const maths = p.rows.filter((r) => r[0] === 'Form 2: Mathematics');
    expect(maths[0]!.slice(1, 5)).toEqual([1, expect.any(String), 'Form 2 West', 90]);
    expect(maths.length).toBe(10);
  });

  it('draws a subject across terms', async () => {
    const p = await an.analyticsPanel(head, 'trend', { subjectId: W.subjects.maths });
    const maths = p.series!.find((s) => s.name === 'Mathematics')!;
    expect(maths.points.map((x) => [x.term, x.value])).toEqual([['Term 3 2025', 62.5], ['Term 1 2026', 65]]);
  });

  it('draws one student across terms, with their overall average', async () => {
    const p = await an.analyticsPanel(head, 'trend', { studentId: east[0]! });
    expect(p.series!.map((s) => s.name)).toEqual(['Overall average', 'English Language', 'Mathematics']);
    expect(p.series![0]!.points.map((x) => x.value)).toEqual([60, 67.5]);
  });

  it('shows a teacher the trend for their own classes only', async () => {
    const own = await an.analyticsPanel(teacher, 'trend', { subjectId: W.subjects.maths });
    expect(own.series![0]!.points.map((x) => x.value)).toEqual([60, 60]); // East only: last term 60, this term 60
    await fails(an.analyticsPanel(teacher, 'trend', { studentId: west[0]! }), 404);
  });
});

describe('at-risk students', () => {
  it('lists a drop of 10 points or more, 3 or more failed subjects, and the O Level passes line, with attendance beside it', async () => {
    const reg = await prisma.attendanceRegister.create({ data: { schoolId: A.schoolId, termId: A.termId, classId: W.f2East, date: new Date('2026-10-05'), session: 'AM', markedById: W.teachers.chikore } });
    await prisma.attendanceEntry.createMany({ data: east.map((s, i) => ({ schoolId: A.schoolId, registerId: reg.id, studentId: s, status: i === 4 ? ('ABSENT' as const) : ('PRESENT' as const) })) });
    const p = await an.analyticsPanel(head, 'atRisk');
    expect(p.rows).toHaveLength(1);
    const r = p.rows[0]!;
    expect(r.slice(0, 2)).toEqual([expect.stringContaining('East'), 'Form 2 East']);
    expect(r[2]).toBe(35);
    expect(r[4]).toBe(25); // 60 last term -> 35: dropped 25
    expect(r[7]).toBe(0); // absent on the only register
    expect(String(r[8])).toMatch(/Dropped 25 points.*passes line/);
  });

  it('shows a class teacher only their own class', async () => {
    const mine = await an.analyticsPanel(classTeacher, 'atRisk');
    expect(mine.rows).toHaveLength(1);
    const other = await actorOf(prisma, await (async () => {
      const id = await addTeacher(prisma, A, 'Other CT');
      const ctRole = await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key: 'CLASS_TEACHER' } });
      await prisma.classTeacher.create({ data: { schoolId: A.schoolId, classId: f2West, termId: A.termId, userId: id } });
      await prisma.userRole.create({ data: { schoolId: A.schoolId, userId: id, roleId: ctRole.id, scopeType: 'CLASS', scopeId: f2West } });
      return id;
    })());
    expect((await an.analyticsPanel(other, 'atRisk')).rows).toHaveLength(0);
  });
});

describe('value added', () => {
  it('compares entry results with current results by class', async () => {
    const all = [...east, ...west];
    for (const [i, s] of Array.from(all.entries())) await prisma.student.update({ where: { id: s }, data: { entryResults: { grade7Units: 6 + i } } });
    const p = await an.analyticsPanel(head, 'valueAdded');
    expect(p.rows).toHaveLength(2);
    expect(p.columns).toContain('Value added');
    // The two classes' value added cancel out around the fitted line.
    const va = p.rows.map((r) => r[7] as number);
    expect(Math.abs(va[0]! + va[1]!)).toBeLessThan(0.1);
    expect(p.rows[0]![3]).toBe('Grade 7 units');
  });
});

describe('ZIMSEC results', () => {
  it('shows pass rates per subject, the 5+ passes share and the own mocks beside it', async () => {
    const f4 = await addClass(prisma, A, 'Form 4 North', { order: 4 });
    const kids = [];
    for (let i = 1; i <= 4; i++) kids.push((await addStudent(prisma, A, { classId: f4.id, firstName: `Z${i}`, surname: `Zim${i}` })).id);
    const session = await prisma.boardSession.create({ data: { schoolId: A.schoolId, board: 'ZIMSEC', category: 'O_LEVEL', session: 'November 2025', centreNumber: '1', feePerSubject: 10, passGrades: ['A', 'B', 'C'], exportColumns: [] } });
    const codes = Object.fromEntries(await Promise.all(['4004', '1122', '2248', '4005', '5006', '6007'].map(async (code, i) => [code, (await prisma.boardSubjectCode.create({ data: { schoolId: A.schoolId, sessionId: session.id, code, name: `Subject ${code}`, subjectId: i === 0 ? W.subjects.maths : i === 1 ? W.subjects.english : null } })).id])));
    await prisma.examSettings.upsert({ where: { schoolId: A.schoolId }, update: { englishSubjectId: W.subjects.english, mathsSubjectId: W.subjects.maths }, create: { schoolId: A.schoolId, englishSubjectId: W.subjects.english, mathsSubjectId: W.subjects.maths } });
    // Two candidates pass six subjects; one fails Maths; one passes only three.
    const grades: Record<string, string[]> = { 7001: ['A', 'B', 'C', 'B', 'C', 'A'], 7002: ['B', 'B', 'B', 'C', 'C', 'B'], 7003: ['D', 'B', 'C', 'B', 'C', 'A'], 7004: ['A', 'A', 'A', 'E', 'E', 'U'] };
    for (const [i, s] of Array.from(kids.entries())) {
      const num = String(7001 + i);
      const cand = await prisma.candidate.create({ data: { schoolId: A.schoolId, sessionId: session.id, studentId: s, candidateNumber: num } });
      for (const [j, code] of Array.from(['4004', '1122', '2248', '4005', '5006', '6007'].entries())) await prisma.boardResult.create({ data: { schoolId: A.schoolId, sessionId: session.id, candidateId: cand.id, studentId: s, candidateNumber: num, codeId: codes[code]!, grade: grades[num]![j]! } });
    }
    const p = await an.analyticsPanel(officer, 'board');
    const maths = p.rows.find((r) => r[1] === '4004')!;
    expect(maths.slice(3, 5)).toEqual([4, 75]); // A, B, D, A: three of four pass
    expect(maths.slice(6, 12)).toEqual([2, 1, 0, 1, 0, 0]);
    const five = p.rows.find((r) => String(r[1]).includes('passes incl. English'))!;
    expect(five.slice(3, 5)).toEqual([4, 50]); // candidates 1 and 2 only
    await fails(an.analyticsPanel(hod, 'board'), 403);
  });
});

describe('before publishing', () => {
  it('labels verified marks as not yet published, and only the Head may look at them', async () => {
    await result({ studentId: east[0]!, subjectId: W.subjects.geography, classId: W.f2East, assignmentId: null, termId: A.termId, mark: 99, published: false });
    const pub = await an.analyticsPanel(head, 'grades');
    expect(pub.rows.some((r) => r[1] === 'Geography')).toBe(false);
    const draft = await an.analyticsPanel(head, 'grades', { source: 'verified' });
    expect(draft).toMatchObject({ notYetPublished: true, label: 'Not yet published: verified marks' });
    expect(draft.rows.some((r) => r[1] === 'Geography')).toBe(true);
    expect(draft.notes.join(' ')).toMatch(/not been published/);
    await fails(an.analyticsPanel(officer, 'grades', { source: 'verified' }), 403, /Only the Head/);
    await fails(an.analyticsPanel(hod, 'grades', { source: 'verified' }), 403);
  });
});

describe('a single assessment', () => {
  it('shows the figures of one assessment instead of the term marks', async () => {
    const T = await typeIds(prisma, A);
    const asm = await prisma.assessment.create({ data: { schoolId: A.schoolId, termId: A.termId, assignmentId: null, levelId: W.form2, subjectId: W.subjects.maths, typeId: T['Class test'] ?? (await prisma.assessmentType.create({ data: { schoolId: A.schoolId, name: 'Class test' } })).id, title: 'Test 1', maxMark: 50 } });
    for (const [i, v] of Array.from([40, 30, 20, 10].entries())) await prisma.assessmentMark.create({ data: { schoolId: A.schoolId, assessmentId: asm.id, assignmentId: mathsEast, studentId: east[i]!, value: v, enteredById: W.teachers.chikore } });
    await prisma.assessmentMark.create({ data: { schoolId: A.schoolId, assessmentId: asm.id, assignmentId: mathsEast, studentId: east[4]!, code: 'AB', enteredById: W.teachers.chikore } });
    await prisma.markSheet.createMany({ data: [{ schoolId: A.schoolId, assignmentId: mathsEast, termId: A.termId, status: 'VERIFIED', submittedAt: new Date(), submittedById: W.teachers.chikore, verifiedAt: new Date(), verifiedById: W.hod }] });
    const p = await an.analyticsPanel(head, 'subjects', { assessmentId: asm.id, source: 'verified' });
    const all = p.rows.find((r) => r[2] === 'All classes')!;
    expect(all.slice(3, 8)).toEqual([5, 40, 40, 80, 0]); // 80, 60, 40, 20, 0 percent (AB counts as 0): mean 40, two of five pass
    expect(p.label).toBe('A single assessment');
  });
});

describe('exports and the one-page summary', () => {
  it('exports a panel to Excel as it is shown, and logs it', async () => {
    const { fileName, buffer } = await an.panelXlsx(head, 'overview');
    expect(fileName).toMatch(/^School overview/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as never);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(4).getCell(1).value).toBe('Form');
    expect(String(ws.getRow(5).getCell(1).value)).toBe('Form 2');
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, entityType: 'ExamAnalytics' } })).toBe(1);
  });

  it('prints a one-page summary for staff and board meetings', async () => {
    const s = await an.resultsSummary(head);
    expect(s.panels.map((p) => p.panel)).toEqual(['overview', 'subjects', 'top']);
    expect(s.label).toBe('Published results');
    expect(s.school).toBe('School A');
  });
});

describe('school isolation', () => {
  it('shows another school nothing', async () => {
    const outsider = await actorOf(prisma, B.operator!.id);
    const p = await an.analyticsPanel(outsider, 'overview');
    expect(p.rows).toEqual([]);
    await fails(an.analyticsPanel(outsider, 'subjects', { assessmentId: 'nope' }), 404);
  });
});

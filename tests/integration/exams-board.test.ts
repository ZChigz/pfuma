// @vitest-environment node
// ZIMSEC / Cambridge registration and results: sessions with configurable fees, dates and subject codes; school and private candidates;
// the checks per candidate; fees with and without Finance; approval by the Head; the configurable export; amendments after approval;
// candidate numbers; and loading released results back.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { actorOf, addTeacher } from '../helpers/academics';
import { examWorld, takeSubject, type ExamWorld } from '../helpers/exams';
import { addClass, addStudent } from '../helpers/students';

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let W: ExamWorld;
let prisma: typeof import('@/lib/prisma').prisma;
let board: typeof import('@/lib/exams/board');
type Actor = Awaited<ReturnType<typeof actorOf>>;

let officer: Actor; let head: Actor; let teacher: Actor;
let students: string[] = [];
let sessionId: string;
let codeIds: Record<string, string> = {};

const fails = async (p: Promise<unknown>, status: number, match?: RegExp) => {
  try { await p; } catch (e) {
    const err = e as { status?: number; message: string };
    expect(err.status).toBe(status);
    if (match) expect(err.message).toMatch(match);
    return;
  }
  throw new Error('expected the call to fail');
};

const SESSION = { board: 'ZIMSEC', category: 'O_LEVEL', session: 'November 2026', centreNumber: '130045', registrationOpens: '2026-03-02', registrationCloses: '2026-04-17', feePerSubject: 12.5, fixedFee: 5, currency: 'USD', passGrades: ['A', 'B', 'C'] };
const list = () => board.entryList(officer, sessionId);

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  board = await import('@/lib/exams/board');
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  W = await examWorld(prisma, A);
  await prisma.subject.update({ where: { id: W.subjects.maths }, data: { zimsecCode: '4004' } });
  await prisma.subject.update({ where: { id: W.subjects.english }, data: { zimsecCode: '1122' } });
  await prisma.subject.update({ where: { id: W.subjects.geography }, data: { zimsecCode: '2248' } });
  const f4 = await addClass(prisma, A, 'Form 4 West', { order: 4 });
  for (let i = 1; i <= 4; i++) students.push((await addStudent(prisma, A, { classId: f4.id, firstName: `Sam${i}`, surname: `Cand${String.fromCharCode(64 + i)}` })).id);
  await takeSubject(prisma, A, students, W.subjects.maths);
  await takeSubject(prisma, A, students, W.subjects.english);
  await takeSubject(prisma, A, students.slice(0, 2), W.subjects.geography);
  await takeSubject(prisma, A, students.slice(0, 1), W.subjects.accounts); // no board code
  officer = await actorOf(prisma, W.examsOfficer);
  head = await actorOf(prisma, A.users.HEAD.id);
  teacher = await actorOf(prisma, W.teachers.chikore);
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('a session', () => {
  it('is for the Exams Officer, with the centre number from School Settings as a starting point', async () => {
    await fails(board.saveSession(teacher, SESSION), 403);
    await prisma.school.update({ where: { id: A.schoolId }, data: { zimsecCentreNumber: '130045' } });
    expect(await board.defaultCentre(officer)).toBe('130045');
    sessionId = (await board.saveSession(officer, SESSION)).id;
    const s = await board.getSession(officer, sessionId);
    expect(s).toMatchObject({ board: 'ZIMSEC', session: 'November 2026', feePerSubject: 12.5, fixedFee: 5, status: 'OPEN', passGrades: ['A', 'B', 'C'] });
  });

  it('puts registration opening and closing on the Calendar, and moves them when they change', async () => {
    const ev = await prisma.calendarEvent.findMany({ where: { schoolId: A.schoolId, autoKey: { startsWith: `board:${sessionId}` } }, orderBy: { startDate: 'asc' } });
    expect(ev.map((e) => [e.title, e.startDate.toISOString().slice(0, 10)])).toEqual([['ZIMSEC November 2026: registration opens', '2026-03-02'], ['ZIMSEC November 2026: registration closes', '2026-04-17']]);
    await board.saveSession(officer, { ...SESSION, registrationCloses: '2026-04-24' }, sessionId);
    expect((await prisma.calendarEvent.findFirstOrThrow({ where: { schoolId: A.schoolId, autoKey: `board:${sessionId}:close` } })).startDate.toISOString().slice(0, 10)).toBe('2026-04-24');
  });

  it('refuses a duplicate, a closing date before the opening, and no pass grades', async () => {
    await fails(board.saveSession(officer, SESSION), 409);
    await expect(board.saveSession(officer, { ...SESSION, session: 'June 2027', registrationCloses: '2027-01-01', registrationOpens: '2027-02-01' })).rejects.toThrow();
    await expect(board.saveSession(officer, { ...SESSION, session: 'June 2027', passGrades: [] })).rejects.toThrow();
  });

  it('keeps sessions of another school apart', async () => {
    const outsider = await actorOf(prisma, B.operator!.id);
    expect(await board.listSessions(outsider)).toEqual([]);
    await fails(board.getSession(outsider, sessionId), 404);
    await fails(board.pullSchoolCandidates(outsider, sessionId), 404);
  });
});

describe('subject codes', () => {
  it('maps a code to the school\'s subject by its ZIMSEC code', async () => {
    await board.saveCodes(officer, sessionId, { codes: [{ code: '4004', name: 'Mathematics' }, { code: '1122', name: 'English Language' }, { code: '2248', name: 'Geography' }, { code: '9999', name: 'Shona' }] });
    const codes = await board.listCodes(officer, sessionId);
    codeIds = Object.fromEntries(codes.map((c) => [c.code, c.id]));
    expect(codes.find((c) => c.code === '4004')).toMatchObject({ subject: 'Mathematics' });
    expect(codes.find((c) => c.code === '9999')!.subject).toBeNull();
    await expect(board.saveCodes(officer, sessionId, { codes: [{ code: '1', name: 'a' }, { code: '1', name: 'b' }] })).rejects.toThrow(/twice/);
  });
});

describe('candidates', () => {
  it('brings in Form 4 with each student\'s subjects mapped to codes, and reports a subject with no code', async () => {
    const r = await board.pullSchoolCandidates(officer, sessionId);
    expect(r).toMatchObject({ added: 4, alreadyThere: 0, unmappedSubjects: ['Accounts'] });
    const l = await list();
    expect(l.candidates).toHaveLength(4);
    expect(l.candidates[0]!.subjects.map((s) => s.code)).toEqual(['1122', '2248', '4004']);
    expect(l.candidates[2]!.subjects.map((s) => s.code)).toEqual(['1122', '4004']);
    expect((await board.pullSchoolCandidates(officer, sessionId)).added).toBe(0);
  });

  it('shows the checks for each candidate', async () => {
    const c = (await list()).candidates[0]!;
    const by = Object.fromEntries(c.checks.map((k) => [k.key, k.ok]));
    expect(by).toEqual({ name: false, dob: true, id: false, photo: false, codes: true, fee: false });
    expect(c.ready).toBe(false);
    expect(c.feeTotal).toBe(42.5); // 3 subjects x 12.50 + 5
  });

  it('adds a private candidate with name, date of birth, ID number and subjects, and refuses a repeated ID', async () => {
    const r = await board.addPrivateCandidate(officer, sessionId, { fullName: 'Tafara Moyo', gender: 'M', dateOfBirth: '2008-02-03', idNumber: '63-123456 A 63', phone: '0771234567', codeIds: [codeIds['4004']!, codeIds['1122']!] });
    expect(r.id).toBeTruthy();
    await fails(board.addPrivateCandidate(officer, sessionId, { fullName: 'Tafara Again', dateOfBirth: '2008-02-03', idNumber: '63-123456 A 63' }), 409);
    await expect(board.addPrivateCandidate(officer, sessionId, { fullName: 'No', dateOfBirth: '2008-02-03', idNumber: 'x' })).rejects.toThrow();
    const c = (await list()).candidates.find((x) => x.kind === 'PRIVATE')!;
    expect(c).toMatchObject({ name: 'Tafara Moyo', surname: 'Moyo', firstNames: 'Tafara', idNumber: '63-123456 A 63', feeTotal: 30 });
    expect(c.checks.find((k) => k.key === 'id')!.ok).toBe(true);
  });

  it('ticks the name check, takes the exact name on the certificate, and a hand-ticked payment', async () => {
    const c = (await list()).candidates.find((x) => x.kind === 'SCHOOL')!;
    await board.updateCandidate(officer, c.id, { nameChecked: true, certificateName: 'CANDA, Samuel Tinashe', feePaid: true });
    const again = (await list()).candidates.find((x) => x.id === c.id)!;
    expect(again).toMatchObject({ nameChecked: true, surname: 'CANDA', firstNames: 'Samuel Tinashe', feePaid: true, feeSource: 'manual' });
  });

  it('is not changed by a teacher', async () => {
    const c = (await list()).candidates[0]!;
    await fails(board.updateCandidate(teacher, c.id, { nameChecked: true }), 403);
    await fails(board.pullSchoolCandidates(teacher, sessionId), 403);
  });
});

describe('fees', () => {
  it('adds a charge to each school candidate\'s account once, and shows paid when a payment with that label is verified', async () => {
    const r = await board.createFeeCharges(officer, sessionId);
    expect(r).toMatchObject({ created: 4, privateCandidates: 1 });
    expect((await board.createFeeCharges(officer, sessionId)).created).toBe(0);
    const charges = await prisma.charge.findMany({ where: { schoolId: A.schoolId, label: 'ZIMSEC November 2026 exam entry' } });
    expect(charges).toHaveLength(4);
    expect(charges.map((c) => Number(c.amount)).sort()).toEqual([30, 30, 42.5, 42.5]);

    const target = (await list()).candidates.filter((c) => c.kind === 'SCHOOL')[1]!;
    expect(target.feePaid).toBe(false);
    await prisma.payment.create({ data: { schoolId: A.schoolId, studentId: target.studentId!, currency: 'USD', amount: target.feeTotal, method: 'CASH', feeLabel: 'ZIMSEC November 2026 exam entry', status: 'VERIFIED', recordedBy: A.users.BURSAR.id, verifiedBy: A.users.HEAD.id } });
    expect((await list()).candidates.find((c) => c.id === target.id)).toMatchObject({ feePaid: true, feeSource: 'finance' });
  });

  it('flags unpaid candidates instead of removing them', async () => {
    const l = await list();
    expect(l.totals.candidates).toBe(5);
    expect(l.totals.unpaid).toBe(3);
    expect(l.candidates.filter((c) => !c.feePaid)).toHaveLength(3);
  });

  it('asks for hand ticks instead when Finance is switched off', async () => {
    await prisma.schoolModule.create({ data: { schoolId: A.schoolId, module: 'finance', enabled: false } });
    await fails(board.createFeeCharges(officer, sessionId), 409, /Finance is switched off/);
    expect((await list()).financeOn).toBe(false);
    await prisma.schoolModule.deleteMany({ where: { schoolId: A.schoolId, module: 'finance' } });
  });
});

describe('approval and export', () => {
  it('cannot be exported before the Head approves, and only the Head approves', async () => {
    await fails(board.exportEntryList(officer, sessionId), 409, /must approve/);
    await fails(board.approveEntryList(officer, sessionId), 403);
    await fails(board.approveEntryList(teacher, sessionId), 403);
  });

  it('is approved with unpaid candidates still on it', async () => {
    const r = await board.approveEntryList(head, sessionId);
    expect(r).toMatchObject({ candidates: 5, unpaid: 3 });
    expect((await board.getSession(head, sessionId)).status).toBe('APPROVED');
    await fails(board.approveEntryList(head, sessionId), 409);
  });

  it('exports in the configured column order, one row per candidate with subjects in columns', async () => {
    await board.saveSession(officer, { ...SESSION, registrationCloses: '2026-04-24', exportColumns: ['centre', 'surname', 'firstNames', 'gender', 'dateOfBirth', 'subjectsSplit', 'feeTotal'] }, sessionId);
    const e = await board.exportEntryList(head, sessionId);
    expect(e.headers).toEqual(['Centre number', 'Surname', 'First names', 'Gender', 'Date of birth', 'Subject 1', 'Subject 2', 'Subject 3', 'Fee total']);
    expect(e.rows).toHaveLength(5);
    expect(e.rows[0]![0]).toBe('130045');
    const canda = e.rows.find((r) => r[1] === 'CANDA')!;
    expect(canda.slice(5, 8)).toEqual(['1122', '2248', '4004']);
    expect(board.exportCsv(e).split('\r\n')[0]).toBe('Centre number,Surname,First names,Gender,Date of birth,Subject 1,Subject 2,Subject 3,Fee total');
    expect((await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: 'EXPORT_ENTRY_LIST' } })).length).toBe(1);
  });

  it('can export one row per candidate and subject', async () => {
    await board.saveSession(officer, { ...SESSION, registrationCloses: '2026-04-24', exportLayout: 'ENTRY', exportColumns: ['centre', 'candidateNumber', 'surname', 'subjectCode', 'subjectName'] }, sessionId);
    const e = await board.exportEntryList(head, sessionId);
    expect(e.headers).toEqual(['Centre number', 'Candidate number', 'Surname', 'Subject code', 'Subject name']);
    expect(e.rows).toHaveLength(3 + 3 + 2 + 2 + 2);
    expect(e.rows.filter((r) => r[3] === '4004')).toHaveLength(5);
  });

  it('gives a count of candidates per subject code for the centre\'s records', async () => {
    const l = await list();
    expect(l.summary.map((s) => [s.code, s.candidates])).toEqual([['1122', 5], ['2248', 2], ['4004', 5]]);
  });

  it('logs every change after approval as an amendment', async () => {
    const c = (await list()).candidates.find((x) => x.kind === 'SCHOOL')!;
    await board.updateCandidate(officer, c.id, { codeIds: [codeIds['4004']!, codeIds['1122']!, codeIds['9999']!] });
    const added = await board.addPrivateCandidate(officer, sessionId, { fullName: 'Late Entry', dateOfBirth: '2007-01-01', idNumber: '63-999999 B 63', codeIds: [codeIds['4004']!] });
    await board.removeCandidate(officer, added.id);
    const am = await prisma.boardAmendment.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
    expect(am.map((a) => a.kind)).toEqual(expect.arrayContaining(['SUBJECT_ADDED', 'SUBJECT_REMOVED', 'CANDIDATE_ADDED', 'CANDIDATE_REMOVED']));
    expect(am.every((a) => a.madeById === W.examsOfficer)).toBe(true);
    expect(am.find((a) => a.kind === 'SUBJECT_ADDED')!.detail).toMatch(/Added 9999/);
  });
});

describe('candidate numbers', () => {
  it('checks a file before applying it: unknown people, repeated numbers and numbers that belong to someone else', async () => {
    const l = await list();
    const [a, b] = l.candidates.filter((c) => c.kind === 'SCHOOL');
    const rows = [
      { identifier: a!.admissionNumber!, candidateNumber: '7001' },
      { identifier: b!.admissionNumber!, candidateNumber: '7001' },
      { identifier: 'NOBODY', candidateNumber: '7002' },
    ];
    const r = await board.importCandidateNumbers(officer, sessionId, { rows });
    expect(r.applied).toBe(0);
    expect(r.review.map((x) => x.status)).toEqual(['ERROR', 'ERROR', 'ERROR']);
    expect(r.review[0]!.message).toMatch(/two candidates in the file/);
    expect(r.review[2]!.message).toMatch(/No candidate/);
    await fails(board.importCandidateNumbers(officer, sessionId, { rows, apply: true }), 409);
  });

  it('sets the numbers, by admission number or ID number, and shows them on the seating order', async () => {
    const l = await list();
    const school = l.candidates.filter((c) => c.kind === 'SCHOOL');
    const priv = l.candidates.find((c) => c.kind === 'PRIVATE')!;
    const rows = [...school.map((c, i) => ({ identifier: c.admissionNumber!, candidateNumber: String(7001 + i) })), { identifier: priv.idNumber!, candidateNumber: '7100' }];
    const r = await board.importCandidateNumbers(officer, sessionId, { rows, apply: true });
    expect(r.applied).toBe(5);
    const after = await list();
    expect(after.candidates.map((c) => c.candidateNumber).sort()).toEqual(['7001', '7002', '7003', '7004', '7100']);
    // They appear on the seating lists of the internal exams (which use the student's candidate number).
    const { candidatesOf } = await import('@/lib/exams/timetable');
    const { getScopedDb } = await import('@/lib/scoped-db');
    const f4 = await prisma.level.findFirstOrThrow({ where: { schoolId: A.schoolId, order: 4 } });
    const seated = await getScopedDb(A.schoolId).$tx((tx) => candidatesOf(tx, A.schoolId, { subjectId: W.subjects.maths, levelId: f4.id }, A.termId));
    expect(seated.map((s) => s.candidateNumber)).toEqual(['7001', '7002', '7003', '7004']);
  });

  it('refuses a number that is already in use by another candidate', async () => {
    const l = await list();
    const [a, b] = l.candidates.filter((c) => c.kind === 'SCHOOL');
    const r = await board.importCandidateNumbers(officer, sessionId, { rows: [{ identifier: a!.admissionNumber!, candidateNumber: b!.candidateNumber! }] });
    expect(r.review[0]!.message).toMatch(/belongs to another candidate/);
  });
});

describe('released results', () => {
  it('are checked and then loaded: candidate number, subject code, grade', async () => {
    await fails(board.importResults(officer.id ? teacher : teacher, sessionId, { rows: [{ candidateNumber: '7001', subjectCode: '4004', grade: 'B' }] }), 403);
    const rows = [
      { candidateNumber: '7001', subjectCode: '4004', grade: 'B' }, { candidateNumber: '7001', subjectCode: '1122', grade: 'C' }, { candidateNumber: '7002', subjectCode: '4004', grade: 'D' },
      { candidateNumber: '7002', subjectCode: '1122', grade: 'c' }, { candidateNumber: '7100', subjectCode: '4004', grade: 'A' },
    ];
    const bad = await board.importResults(officer, sessionId, { rows: [...rows, { candidateNumber: '0000', subjectCode: '4004', grade: 'A' }, { candidateNumber: '7001', subjectCode: '5555', grade: 'A' }, { candidateNumber: '7003', subjectCode: '4004', grade: 'AAAA' }] });
    expect(bad.review.filter((r) => r.status === 'ERROR')).toHaveLength(3);
    expect(bad.applied).toBe(0);
    const ok = await board.importResults(officer, sessionId, { rows, apply: true });
    expect(ok).toMatchObject({ applied: 5, updated: 0 });
    const stored = await prisma.boardResult.findMany({ where: { sessionId } });
    expect(stored).toHaveLength(5);
    expect(stored.find((r) => r.candidateNumber === '7002' && r.grade === 'C')).toBeTruthy(); // lower case is accepted
  });

  it('can be loaded again with a corrected grade', async () => {
    const r = await board.importResults(officer, sessionId, { rows: [{ candidateNumber: '7002', subjectCode: '4004', grade: 'C' }], apply: true });
    expect(r).toMatchObject({ applied: 0, updated: 1 });
  });

  it('attach to the student\'s record', async () => {
    const stu = await prisma.candidate.findFirstOrThrow({ where: { sessionId, candidateNumber: '7001' } });
    const res = await board.boardResultsFor(head, stu.studentId!);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ board: 'ZIMSEC', session: 'November 2026' });
    expect(res[0]!.results.map((x) => [x.code, x.grade])).toEqual([['1122', 'C'], ['4004', 'B']]);
  });

  it('do not let a candidate with results be removed or lose that subject', async () => {
    const c = await prisma.candidate.findFirstOrThrow({ where: { sessionId, candidateNumber: '7001' } });
    await fails(board.removeCandidate(officer, c.id), 409, /has results/);
    await fails(board.updateCandidate(officer, c.id, { codeIds: [codeIds['1122']!] }), 409, /already has a result/);
  });
});

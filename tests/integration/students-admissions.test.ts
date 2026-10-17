// @vitest-environment node
// The admissions pipeline: intakes, applications, stages, the Head's approval of offers, acceptance, enrolling an
// applicant as a student, ranking and the intake report.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { addClass, dayOffset } from '../helpers/students';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
const Y = Number(dayOffset(0).slice(0, 4));
let intakeId: string; // a small intake (3 places)
let roomId: string; // a roomy one, where most applicants go
let form1North: string;
let n = 0;

const letters = (k: number) => String(k).replace(/\d/g, (d) => 'abcdefghij'[Number(d)]!);
const applicant = (over: Record<string, unknown> = {}) => {
  n++;
  return {
    intakeId: roomId, firstName: `Apply${letters(n)}`, surname: 'Candidate', gender: n % 2 ? 'M' : 'F', dateOfBirth: `${Y - 13}-02-${String((n % 27) + 1).padStart(2, '0')}`,
    guardianName: `Parent ${letters(n)}`, guardianRelationship: 'MOTHER', guardianPhone: `07731${String(10000 + n)}`, previousSchool: 'Mbare Primary', entryResults: { grade7Units: 10 }, ...over,
  };
};
const apply = async (over: Record<string, unknown> = {}, as = A.users.ADMIN) => {
  const r = await call('students/admissions/applications', 'POST', { as, body: applicant(over) });
  expect(r.status, r.text).toBe(201);
  return r.json.data.id as string;
};
const move = (ids: string[], to: string, as: { id: string } = A.users.ADMIN, note?: string) =>
  call('students/admissions/applications/move', 'POST', { as: as as never, body: { applicationIds: ids, to, note } });
const stageOf = async (id: string) => (await prisma.application.findUniqueOrThrow({ where: { id } })).stage;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  for (const S of [A, B]) await prisma.academicTerm.update({ where: { id: S.termId }, data: { startDate: new Date(`${dayOffset(-30)}T00:00:00Z`), endDate: new Date(`${dayOffset(60)}T00:00:00Z`) } });
  form1North = A.classId;
  await prisma.school.update({ where: { id: A.schoolId }, data: { schoolCode: 'ADM', headName: 'Mrs R. Ncube' } });
  await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.admissions.view');
  await grantPermission(prisma, A.schoolId, 'BURSAR', 'students.admissions.view');
  await grantPermission(prisma, A.schoolId, 'BURSAR', 'students.admissions.manage'); // may manage, may not approve
  const r = await call('students/admissions', 'POST', {
    as: A.users.ADMIN,
    body: { name: `Form 1, ${Y + 1}`, levelId: A.levelId, year: Y + 1, places: 3, testDate: dayOffset(20), reportingDate: dayOffset(100), applicationFee: 10, requirements: ['Birth certificate copy', 'Two passport photos'] },
  });
  intakeId = r.json.data.id;
  roomId = (await call('students/admissions', 'POST', { as: A.users.ADMIN, body: { name: `Roomy ${letters(Y)}`, levelId: A.levelId, year: Y, places: 60, reportingDate: dayOffset(100), requirements: ['Birth certificate copy', 'Two passport photos'] } })).json.data.id;
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('intakes', () => {
  it('can be seen with students.admissions.view and made or changed with students.admissions.manage', async () => {
    const list = await call('students/admissions', 'GET', { as: A.users.TEACHER });
    expect(list.status).toBe(200);
    expect(list.json.data.intakes[0]).toMatchObject({ name: `Form 1, ${Y + 1}`, level: 'Form 1', places: 3, applicationFee: 10, requirements: ['Birth certificate copy', 'Two passport photos'] });
    expect((await call('students/admissions', 'GET', { as: A.users.HEAD })).status).toBe(403);
    expect((await call('students/admissions', 'POST', { as: A.users.TEACHER, body: { name: 'Form 1, 2030', levelId: A.levelId, year: 2030, places: 10 } })).status).toBe(403);
    expect((await call('students/admissions/[intakeId]', 'PATCH', { as: A.users.TEACHER, params: { intakeId }, body: { name: 'x', levelId: A.levelId, year: 2030, places: 1 } })).status).toBe(403);
  });

  it('check their fields, and the form must belong to the school', async () => {
    const post = (body: Record<string, unknown>) => call('students/admissions', 'POST', { as: A.users.ADMIN, body: { name: 'Lower 6, 2030', levelId: A.levelId, year: 2030, places: 10, ...body } });
    expect((await post({ places: 0 })).status).toBe(422);
    expect((await post({ name: 'x' })).status).toBe(422);
    expect((await post({ year: 1990 })).status).toBe(422);
    expect((await post({ applicationFee: -5 })).status).toBe(422);
    expect((await post({ applicationOpens: '2030-03-01', applicationCloses: '2030-02-01' })).status).toBe(422);
    expect((await post({ testDate: 'tomorrow' })).status).toBe(422);
    expect((await post({ levelId: B.levelId })).status).toBe(404);
    expect((await post({ name: `form 1, ${Y + 1}` })).status).toBe(409);
    expect((await post({})).status).toBe(201);
  });

  it('keep at least as many places as there are offers', async () => {
    const mini = (await call('students/admissions', 'POST', { as: A.users.ADMIN, body: { name: `Mini ${letters(Y)}`, levelId: A.levelId, year: Y, places: 2 } })).json.data.id;
    const ids = [await apply({ intakeId: mini }), await apply({ intakeId: mini })];
    await move(ids, 'OFFERED');
    const shrink = await call('students/admissions/[intakeId]', 'PATCH', { as: A.users.ADMIN, params: { intakeId: mini }, body: { name: `Mini ${letters(Y)}`, levelId: A.levelId, year: Y, places: 1 } });
    expect(shrink.status).toBe(409);
  });
});

describe('applications', () => {
  it('need students.admissions.manage and check the student and guardian fields', async () => {
    expect((await call('students/admissions/applications', 'POST', { as: A.users.TEACHER, body: applicant() })).status).toBe(403);
    const bad = async (over: Record<string, unknown>) => (await call('students/admissions/applications', 'POST', { as: A.users.ADMIN, body: applicant(over) })).status;
    expect(await bad({ firstName: 'A' })).toBe(422);
    expect(await bad({ gender: 'X' })).toBe(422);
    expect(await bad({ dateOfBirth: dayOffset(4) })).toBe(422);
    expect(await bad({ guardianPhone: '123' })).toBe(422);
    expect(await bad({ guardianName: 'Madonna' })).toBe(422);
    expect(await bad({ birthCertificateNumber: 'abc' })).toBe(422);
    expect(await bad({ entryResults: { grade7Units: 99 } })).toBe(422);
    expect(await bad({ testScore: 140 })).toBe(422);
    expect(await bad({ intakeId: 'nope' })).toBe(404);
  });

  it('start at Applied with a stage history, and cannot be entered twice for one intake', async () => {
    const body = applicant({ firstName: 'Twinned', dateOfBirth: `${Y - 13}-09-09` });
    const first = await call('students/admissions/applications', 'POST', { as: A.users.ADMIN, body });
    expect(first.status).toBe(201);
    const row = await prisma.application.findUniqueOrThrow({ where: { id: first.json.data.id } });
    expect(row.stage).toBe('APPLIED');
    expect(row.stageHistory).toMatchObject([{ stage: 'APPLIED', byId: A.users.ADMIN.id }]);
    expect((await call('students/admissions/applications', 'POST', { as: A.users.ADMIN, body: { ...body, guardianPhone: '0773999000' } })).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'CREATE_APPLICATION', entityId: row.id } })).toBe(1);
  });

  it('are refused for a closed intake or after the closing date, and for another school', async () => {
    const closed = (await call('students/admissions', 'POST', { as: A.users.ADMIN, body: { name: `Closed ${letters(Y)}`, levelId: A.levelId, year: Y, places: 5, closed: true } })).json.data.id;
    expect((await call('students/admissions/applications', 'POST', { as: A.users.ADMIN, body: applicant({ intakeId: closed }) })).status).toBe(409);
    const late = (await call('students/admissions', 'POST', { as: A.users.ADMIN, body: { name: `Late ${letters(Y)}`, levelId: A.levelId, year: Y, places: 5, applicationOpens: dayOffset(-60), applicationCloses: dayOffset(-2) } })).json.data.id;
    expect((await call('students/admissions/applications', 'POST', { as: A.users.ADMIN, body: applicant({ intakeId: late }) })).status).toBe(409);
    expect((await call('students/admissions/applications', 'POST', { as: B.users.ADMIN, body: applicant() })).status).toBe(404);
  });

  it('keep a test score, interview notes and the intended class', async () => {
    const id = await apply();
    const patch = (body: Record<string, unknown>, as = A.users.ADMIN) => call('students/admissions/applications/[id]', 'PATCH', { as, params: { id }, body });
    expect((await patch({ testScore: 72.5, interviewNotes: 'Confident and polite', targetClassId: form1North })).status).toBe(200);
    expect(await prisma.application.findUniqueOrThrow({ where: { id } })).toMatchObject({ interviewNotes: 'Confident and polite', targetClassId: form1North });
    expect((await prisma.application.findUniqueOrThrow({ where: { id } })).testScore!.toNumber()).toBe(72.5);
    expect((await patch({ testScore: 101 })).status).toBe(422);
    expect((await patch({ stage: 'ENROLLED' })).status).toBe(422);
    expect((await patch({ targetClassId: B.classId })).status).toBe(404);
    expect((await patch({})).status).toBe(422);
    expect((await patch({ testScore: 10 }, A.users.TEACHER)).status).toBe(403);
  });
});

describe('moving applicants', () => {
  it('shortlists, rejects and waitlists many at once, writing a stage history and an audit entry for each', async () => {
    const ids = [await apply(), await apply(), await apply()];
    const r = await move(ids, 'SHORTLISTED', A.users.BURSAR, 'Strong results');
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ moved: 3, to: 'SHORTLISTED' });
    for (const id of ids) {
      const a = await prisma.application.findUniqueOrThrow({ where: { id } });
      expect(a.stage).toBe('SHORTLISTED');
      expect((a.stageHistory as { stage: string; byId: string; note?: string }[]).map((h) => h.stage)).toEqual(['APPLIED', 'SHORTLISTED']);
      expect((a.stageHistory as { note?: string }[])[1]!.note).toBe('Strong results');
    }
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'MOVE_APPLICATION', entityId: { in: ids } } })).toBe(3);
    expect((await move([ids[0]!], 'REJECTED')).status).toBe(200);
    expect((await move([ids[1]!], 'WAITLISTED')).status).toBe(200);
    expect((await move([ids[2]!], 'TESTED')).status).toBe(200);
  });

  it('is all or nothing, and never goes backwards or out of a final stage', async () => {
    const a = await apply();
    const b = await apply();
    await move([b], 'REJECTED');
    const r = await move([a, b], 'SHORTLISTED');
    expect(r.status).toBe(409);
    expect(await stageOf(a)).toBe('APPLIED');
    await move([a], 'TESTED');
    expect((await move([a], 'SHORTLISTED')).status).toBe(409);
    expect((await move([a], 'ENROLLED')).status).toBe(409);
    expect((await move([a], 'ACCEPTED')).status).toBe(422);
    expect((await move(['nope'], 'SHORTLISTED')).status).toBe(404);
    expect((await move([a], 'SOMEWHERE')).status).toBe(422);
    expect((await move([], 'SHORTLISTED')).status).toBe(422);
  });

  it("does not reach another school's applicants", async () => {
    const mine = await apply();
    expect((await move([mine], 'SHORTLISTED', B.users.ADMIN)).status).toBe(404);
    expect(await stageOf(mine)).toBe('APPLIED');
  });

  it('keeps offers for the Head: someone who cannot approve is refused and nothing changes', async () => {
    const id = await apply();
    const r = await move([id], 'OFFERED', A.users.BURSAR);
    expect(r.status).toBe(403);
    expect(r.json.message).toContain('Head');
    expect(await stageOf(id)).toBe('APPLIED');
    expect(await prisma.studentDocument.count({ where: { applicationId: id } })).toBe(0);
  });

  it('records who approved an offer and files the offer letter with a reference number', async () => {
    const id = await apply();
    const r = await move([id], 'OFFERED', A.users.ADMIN);
    expect(r.status).toBe(200);
    const a = await prisma.application.findUniqueOrThrow({ where: { id } });
    expect(a).toMatchObject({ stage: 'OFFERED', offerApprovedById: A.users.ADMIN.id });
    expect(a.offerApprovedAt).toBeTruthy();
    expect(a.offerReference).toMatch(new RegExp(`^OFR-${Y}-\\d{5}$`));
    const doc = await prisma.studentDocument.findFirstOrThrow({ where: { applicationId: id } });
    expect(doc).toMatchObject({ type: 'LETTER_OFFER', generated: true, referenceNo: a.offerReference, studentId: null });
    expect(doc.snapshot).toMatchObject({ body: { applicantName: expect.stringContaining('Candidate'), intakeName: `Roomy ${letters(Y)}`, requirements: ['Birth certificate copy', 'Two passport photos'] } });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'APPROVE_OFFER', entityId: id } });
    expect(audit.after).toMatchObject({ stage: 'OFFERED', approvedById: A.users.ADMIN.id });
  });

  it('never makes more offers than there are places', async () => {
    const mini = (await call('students/admissions', 'POST', { as: A.users.ADMIN, body: { name: `Tight ${letters(Y)}`, levelId: A.levelId, year: Y, places: 2 } })).json.data.id;
    const ids = [await apply({ intakeId: mini }), await apply({ intakeId: mini }), await apply({ intakeId: mini })];
    const r = await move(ids, 'OFFERED');
    expect(r.status).toBe(409);
    expect(r.json.message).toContain('2 places');
    for (const id of ids) expect(await stageOf(id)).toBe('APPLIED');
    expect((await move(ids.slice(0, 2), 'OFFERED')).status).toBe(200);
    expect((await move([ids[2]!], 'OFFERED')).status).toBe(409);
  });

  it('prints the offer letter as a PDF for those who may see admissions', async () => {
    const id = await apply();
    expect((await call('students/admissions/applications/[id]/offer-letter', 'GET', { as: A.users.ADMIN, params: { id } })).status).toBe(404); // no offer yet
    await move([id], 'OFFERED');
    const pdf = await call('students/admissions/applications/[id]/offer-letter', 'GET', { as: A.users.TEACHER, params: { id } });
    expect(pdf.status).toBe(200);
    expect(pdf.response.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.text.startsWith('%PDF')).toBe(true);
    expect((await call('students/admissions/applications/[id]/offer-letter', 'GET', { as: A.users.HEAD, params: { id } })).status).toBe(403);
    expect((await call('students/admissions/applications/[id]/offer-letter', 'GET', { as: B.users.ADMIN, params: { id } })).status).toBe(404);
  });
});

describe('accepting an offer', () => {
  it('records the date, and the deposit when Finance is on', async () => {
    const id = await apply();
    const accept = (body: Record<string, unknown> = {}, as = A.users.ADMIN) => call('students/admissions/applications/[id]/accept', 'POST', { as, params: { id }, body });
    expect((await accept()).status).toBe(409); // not offered yet
    await move([id], 'OFFERED');
    expect((await accept({ acceptedOn: dayOffset(3) })).status).toBe(422);
    expect((await accept({}, A.users.TEACHER)).status).toBe(403);
    expect((await accept({ acceptedOn: dayOffset(-1), depositPaid: true })).status).toBe(200);
    const a = await prisma.application.findUniqueOrThrow({ where: { id } });
    expect(a).toMatchObject({ stage: 'ACCEPTED', depositPaid: true });
    expect(a.acceptedAt!.toISOString().slice(0, 10)).toBe(dayOffset(-1));
    expect((await accept()).status).toBe(409); // already accepted
  });

  it('does not ask about a deposit when Finance is off', async () => {
    await prisma.schoolModule.upsert({ where: { schoolId_module: { schoolId: A.schoolId, module: 'finance' } }, update: { enabled: false }, create: { schoolId: A.schoolId, module: 'finance', enabled: false } });
    const id = await apply();
    await move([id], 'OFFERED');
    const accept = (body: Record<string, unknown>) => call('students/admissions/applications/[id]/accept', 'POST', { as: A.users.ADMIN, params: { id }, body });
    expect((await accept({ depositPaid: true })).status).toBe(409);
    expect((await accept({})).status).toBe(200);
    expect((await prisma.application.findUniqueOrThrow({ where: { id } })).depositPaid).toBeNull();
    await prisma.schoolModule.update({ where: { schoolId_module: { schoolId: A.schoolId, module: 'finance' } }, data: { enabled: true } });
  });
});

describe('enrolling an applicant', () => {
  const accepted = async (over: Record<string, unknown> = {}) => {
    const id = await apply(over);
    await move([id], 'OFFERED');
    await call('students/admissions/applications/[id]/accept', 'POST', { as: A.users.ADMIN, params: { id }, body: {} });
    return id;
  };
  const enrol = (id: string, body: Record<string, unknown>, as = A.users.ADMIN) => call('students/admissions/applications/[id]/enrol', 'POST', { as, params: { id }, body });

  it('turns an accepted applicant into a student with a new admission number and an Enrollment in the chosen class', async () => {
    const id = await accepted({ birthCertificateNumber: '63-424242 A 42', address: '5 Mbare Rd, Harare' });
    await call('students/admissions/applications/[id]/documents', 'POST', {
      as: A.users.ADMIN, params: { id }, body: { type: 'GRADE7_RESULTS_SLIP', title: 'Grade 7 slip', fileKey: `sdoc:${A.schoolId}:slipslipslip1`, mimeType: 'application/pdf', sizeBytes: 90_000 },
    });
    const r = await enrol(id, { classId: form1North, acknowledgedWarnings: ['AGE_OUT_OF_RANGE', 'CLASS_FULL'] });
    expect(r.status, r.text).toBe(201);
    const student = await prisma.student.findUniqueOrThrow({ where: { id: r.json.data.student.id }, include: { enrollments: true, guardians: { include: { guardian: true } } } });
    expect(student).toMatchObject({
      status: 'ACTIVE', entryType: 'NEW_FORM_1', previousSchool: 'Mbare Primary', birthCertificateNumber: '63424242A42', currentClassId: form1North, address: '5 Mbare Rd, Harare', entryResults: { grade7Units: 10 },
    });
    expect(student.admissionNumber).toMatch(/^ADM\d{8}$/);
    expect(student.enrollments).toMatchObject([{ termId: A.termId, classId: form1North, status: 'ACTIVE' }]);
    expect(student.guardians[0]).toMatchObject({ isPrimary: true, isFeePayer: true, relationship: 'MOTHER' });
    const app = await prisma.application.findUniqueOrThrow({ where: { id } });
    expect(app).toMatchObject({ stage: 'ENROLLED', studentId: student.id });
    expect((app.stageHistory as { stage: string }[]).map((h) => h.stage)).toEqual(['APPLIED', 'OFFERED', 'ACCEPTED', 'ENROLLED']);
    // the applicant's documents are now on the student's file
    const docs = await prisma.studentDocument.findMany({ where: { applicationId: id } });
    expect(docs.length).toBeGreaterThanOrEqual(2);
    expect(docs.every((d) => d.studentId === student.id)).toBe(true);
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'ENROL_APPLICANT', entityId: id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'ADMIT_STUDENT', entityId: student.id } })).toBe(1);
  });

  it('only enrols someone who has accepted, once, into a class of the form they were offered', async () => {
    const offered = await apply();
    await move([offered], 'OFFERED');
    expect((await enrol(offered, { classId: form1North })).status).toBe(409);
    const id = await accepted();
    const level2 = await addClass(prisma, A, 'Form 2 East');
    expect((await enrol(id, { classId: level2.id })).status).toBe(422);
    expect((await enrol(id, { classId: B.classId })).status).toBe(404);
    expect((await enrol(id, { classId: 'nope' })).status).toBe(404);
    expect((await enrol(id, { classId: form1North }, A.users.TEACHER)).status).toBe(403);
    expect((await enrol(id, { classId: form1North, acknowledgedWarnings: ['AGE_OUT_OF_RANGE', 'CLASS_FULL', 'POSSIBLE_DUPLICATE'] })).status).toBe(201);
    expect((await enrol(id, { classId: form1North, acknowledgedWarnings: ['AGE_OUT_OF_RANGE', 'CLASS_FULL'] })).status).toBe(409); // already a student
  });

  it('shows the warnings first and enrols only when they are acknowledged', async () => {
    const tiny = await addClass(prisma, A, 'Form 1 Tiny', { capacity: 1, order: 1 });
    await prisma.student.update({ where: { id: A.studentId }, data: { currentClassId: tiny.id } });
    await prisma.enrollment.updateMany({ where: { studentId: A.studentId }, data: { classId: tiny.id } });
    const id = await accepted();
    const dry = await enrol(id, { classId: tiny.id, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.json.data.dryRun).toBe(true);
    expect(dry.json.data.check.warnings.map((w: { code: string }) => w.code)).toContain('CLASS_FULL');
    expect(await stageOfAcc(id)).toBe('ACCEPTED');
    const refused = await enrol(id, { classId: tiny.id });
    expect(refused.status).toBe(409);
    expect(refused.json.message).toContain('capacity is 1');
    expect(await stageOfAcc(id)).toBe('ACCEPTED');
    expect((await enrol(id, { classId: tiny.id, acknowledgedWarnings: ['CLASS_FULL'] })).status).toBe(201);
    async function stageOfAcc(x: string) { return stageOf(x); }
  });

  it('is stopped by a birth certificate number that is already in use, leaving the applicant accepted', async () => {
    const first = await accepted({ birthCertificateNumber: '75-535353 B 11' });
    const second = await accepted({ birthCertificateNumber: '75-535353 B 11' });
    expect((await enrol(first, { classId: form1North, acknowledgedWarnings: ['CLASS_FULL'] })).status).toBe(201);
    const r = await enrol(second, { classId: form1North, acknowledgedWarnings: ['CLASS_FULL'] });
    expect(r.status).toBe(409);
    expect(await stageOf(second)).toBe('ACCEPTED');
    expect(await prisma.application.findUniqueOrThrow({ where: { id: second } })).toMatchObject({ studentId: null });
  });
});

describe('applicant documents', () => {
  it('are private uploads that belong to this school', async () => {
    const id = await apply();
    const up = (body: Record<string, unknown>, as = A.users.ADMIN) => call('students/admissions/applications/[id]/documents', 'POST', { as, params: { id }, body });
    const doc = { type: 'BIRTH_CERTIFICATE', title: 'Birth certificate', fileKey: `sdoc:${A.schoolId}:applicantdoc12`, mimeType: 'image/jpeg', sizeBytes: 1000 };
    expect((await up(doc, A.users.TEACHER)).status).toBe(403);
    expect((await up({ ...doc, fileKey: `sdoc:${B.schoolId}:applicantdoc12` })).status).toBe(422);
    expect((await up({ ...doc, sizeBytes: 6_000_000 })).status).toBe(422);
    expect((await up(doc)).status).toBe(201);
    expect(await prisma.studentDocument.findFirstOrThrow({ where: { applicationId: id } })).toMatchObject({ studentId: null, type: 'BIRTH_CERTIFICATE' });
  });
});

describe('the board, the ranking and the report', () => {
  let ranked: string;

  it('ranks applicants by Grade 7 units, test score or points, with the cut-off at the number of places', async () => {
    ranked = (await call('students/admissions', 'POST', { as: A.users.ADMIN, body: { name: `Ranked ${letters(Y)}`, levelId: A.levelId, year: Y, places: 2 } })).json.data.id;
    const a = await apply({ intakeId: ranked, firstName: 'Alpha', entryResults: { grade7Units: 8 }, gender: 'F' });
    const b = await apply({ intakeId: ranked, firstName: 'Bravo', entryResults: { grade7Units: 5 }, gender: 'M' });
    const c = await apply({ intakeId: ranked, firstName: 'Charlie', entryResults: { grade7Units: 11 }, gender: 'F' });
    const d = await apply({ intakeId: ranked, firstName: 'Delta', entryResults: {}, gender: 'M' });
    for (const [id, score] of [[a, 60], [b, 55], [c, 90]] as const) await call('students/admissions/applications/[id]', 'PATCH', { as: A.users.ADMIN, params: { id }, body: { testScore: score } });
    const rank = async (by: string) => (await call('students/admissions/[intakeId]', 'GET', { as: A.users.ADMIN, params: { intakeId: ranked }, query: `?by=${by}` })).json.data.ranking.map((r: { fullName: string; rank: number; withinPlaces: boolean }) => `${r.rank}${r.withinPlaces ? '*' : ''}:${r.fullName.split(' ')[0]}`);
    expect(await rank('units')).toEqual(['1*:Bravo', '2*:Alpha', '3:Charlie', '4:Delta']);
    expect(await rank('score')).toEqual(['1*:Charlie', '2*:Alpha', '3:Bravo', '4:Delta']);
    await move([c], 'REJECTED');
    expect(await rank('units')).toEqual(['1*:Bravo', '2*:Alpha', '3:Delta']); // rejected applicants are not ranked
    expect(d).toBeTruthy();
  });

  it('counts applications, offers, acceptances and enrolments by gender, with the conversion at each stage', async () => {
    const rep = (await call('students/admissions/[intakeId]', 'GET', { as: A.users.ADMIN, params: { intakeId: ranked } })).json.data.report;
    expect(rep.stages.map((s: { key: string; total: number }) => [s.key, s.total])).toEqual([['applications', 4], ['offers', 0], ['acceptances', 0], ['enrolments', 0]]);
    expect(rep.stages[0]).toMatchObject({ male: 2, female: 2, conversion: null });
    const apps = await prisma.application.findMany({ where: { intakeId: ranked }, orderBy: { firstName: 'asc' } });
    const [alpha, bravo] = [apps[0]!.id, apps[1]!.id];
    await move([alpha, bravo], 'OFFERED');
    await call('students/admissions/applications/[id]/accept', 'POST', { as: A.users.ADMIN, params: { id: bravo }, body: {} });
    const rep2 = (await call('students/admissions/[intakeId]', 'GET', { as: A.users.ADMIN, params: { intakeId: ranked } })).json.data.report;
    expect(rep2.stages[1]).toMatchObject({ key: 'offers', total: 2, male: 1, female: 1, conversion: 50 });
    expect(rep2.stages[2]).toMatchObject({ key: 'acceptances', total: 1, male: 1, female: 0, conversion: 50 });
    expect(rep2.stages[3]).toMatchObject({ key: 'enrolments', total: 0, conversion: 0 });
  });

  it('lists applicants with the fields the board needs, to those who may see admissions only', async () => {
    const r = await call('students/admissions/[intakeId]', 'GET', { as: A.users.TEACHER, params: { intakeId: ranked } });
    expect(r.status).toBe(200);
    expect(r.json.data.applicants[0]).toMatchObject({ fullName: expect.any(String), stage: expect.any(String), guardianPhone: expect.stringMatching(/^\+263/) });
    expect((await call('students/admissions/[intakeId]', 'GET', { as: A.users.HEAD, params: { intakeId: ranked } })).status).toBe(403);
    expect((await call('students/admissions/[intakeId]', 'GET', { as: B.users.ADMIN, params: { intakeId: ranked } })).status).toBe(404);
  });
});

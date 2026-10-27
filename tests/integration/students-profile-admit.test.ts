// @vitest-environment node
// The student profile (header, alert strip, tabs and who sees what), adding a student (four steps, warnings,
// duplicates, shared guardians, the Head's approval of transfers in), editing, and guardians.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, seedSchool, userWithRoles, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { addClass, addStudent, dayOffset } from '../helpers/students';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
let form2East: string;
// Dates of birth are written as "N years ago" so the age rules stay true whenever the tests run.
const Y = Number(dayOffset(0).slice(0, 4));

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  for (const S of [A, B]) await prisma.academicTerm.update({ where: { id: S.termId }, data: { startDate: new Date(`${dayOffset(-30)}T00:00:00Z`), endDate: new Date(`${dayOffset(60)}T00:00:00Z`) } });
  form2East = (await addClass(prisma, A, 'Form 2 East')).id;
  await prisma.school.update({ where: { id: A.schoolId }, data: { schoolCode: 'MHS' } });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

const get = (as: { id: string } | null, id: string, tab = '') => call(`students/[id]${tab}` as never, 'GET', { as: as as never, params: { id } });

// ─── Profile ─────────────────────────────────────────────────────────────────

describe('the profile header and alert strip', () => {
  it('needs students.profiles.view and only opens students of the same school', async () => {
    const s = await addStudent(prisma, A);
    expect((await get(await userWithRoles(prisma, A, []), s.id)).status).toBe(403);
    expect((await get(null, s.id)).status).toBe(401);
    expect((await get(A.operator!, (await addStudent(prisma, B)).id)).status).toBe(404);
    expect((await get(A.operator!, 'does-not-exist')).status).toBe(404);
  });

  it('shows the photo, name, admission number, class, status, boarding, house, age and the buttons the user may press', async () => {
    const h = await prisma.house.create({ data: { schoolId: A.schoolId, name: 'Kariba' } });
    const s = await addStudent(prisma, A, { boarding: 'BOARDER' });
    await prisma.student.update({ where: { id: s.id }, data: { houseId: h.id, photoUrl: 'https://utfs.io/f/abc.png', preferredName: 'Tee' } });
    const r = await get(A.operator!, s.id);
    expect(r.status).toBe(200);
    expect(r.json.data.header).toMatchObject({
      fullName: s.fullName, preferredName: 'Tee', photoUrl: 'https://utfs.io/f/abc.png', admissionNumber: s.admissionNumber, className: 'Form 1 North', status: 'ACTIVE', boarding: 'BOARDER', houseName: 'Kariba',
      actions: { edit: true, moveClass: true, recordIncident: true, print: true, startLeaving: true, regenerateAdmissionLetter: true, rejoin: false },
    });
    expect(r.json.data.header.age).toBeGreaterThanOrEqual(12);
    expect(r.json.data.header.alerts).toEqual([]);
  });

  it('hides the buttons a user may not press', async () => {
    await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.profiles.view');
    const r = await get(A.users.TEACHER, A.studentId);
    expect(r.json.data.header.actions).toMatchObject({ edit: false, moveClass: false, recordIncident: true, startLeaving: false, regenerateAdmissionLetter: false }); // a teacher may record an incident
    const gone = await addStudent(prisma, A, { status: 'WITHDRAWN' });
    expect((await get(A.operator!, gone.id)).json.data.header.actions).toMatchObject({ moveClass: false, startLeaving: false, rejoin: true });
  });

  it('names the allergy only for someone who may see medical details', async () => {
    const s = await addStudent(prisma, A);
    await prisma.medicalProfile.create({ data: { schoolId: A.schoolId, studentId: s.id, allergies: [{ name: 'penicillin', severity: 'SEVERE' }], hasSevereAllergy: true } });
    const admin = await get(A.operator!, s.id);
    expect(admin.json.data.header.alerts).toEqual([{ kind: 'medical', text: 'Allergy: penicillin' }]);
    const teacher = await get(A.users.TEACHER, s.id);
    expect(teacher.json.data.header.alerts).toEqual([{ kind: 'medical', text: 'Medical alert: severe allergy' }]);
    expect(JSON.stringify(teacher.json)).not.toContain('penicillin');
  });

  it('adds the suspension end date, special needs and the custody note', async () => {
    const s = await addStudent(prisma, A);
    await prisma.student.update({ where: { id: s.id }, data: { status: 'SUSPENDED', specialNeeds: true, specialNeedsNote: 'Dyslexia' } });
    const inc = await prisma.disciplineIncident.create({ data: { schoolId: A.schoolId, occurredAt: new Date(), location: 'CLASSROOM', category: 'FIGHTING', severity: 'SERIOUS', description: 'x', recordedById: A.operator!.id } });
    await prisma.disciplineAction.create({ data: { schoolId: A.schoolId, incidentId: inc.id, studentId: s.id, type: 'SUSPENSION', status: 'APPROVED', startDate: new Date(`${dayOffset(0)}T00:00:00Z`), endDate: new Date(`${dayOffset(4)}T00:00:00Z`), requestedById: A.operator!.id, approvedById: A.operator!.id } });
    await prisma.studentGuardian.updateMany({ where: { studentId: s.id }, data: { custodyNote: 'Only collect with mother' } });
    const alerts = (await get(A.users.TEACHER, s.id)).json.data.header.alerts;
    expect(alerts.map((a: { kind: string }) => a.kind)).toEqual(['suspension', 'special-needs', 'custody']);
    expect(alerts[0].text).toContain(dayOffset(4));
    expect(alerts[2].text).toBe('Only collect with mother');
  });

  it('lists only the tabs the user may open', async () => {
    const tabs = async (u: { id: string }) => (await get(u, A.studentId)).json.data.tabs.map((x: { key: string }) => x.key);
    expect(await tabs(A.operator!)).toEqual(['overview', 'guardians', 'enrolment', 'documents', 'discipline', 'medical', 'activity']);
    // A subject teacher of the class holds students.profiles.view only; the class teacher also sees guardians and discipline.
    const subjectTeacher = await userWithRoles(prisma, A, ['TEACHER'], 'subject-teacher');
    await prisma.subjectAssignment.updateMany({ where: { classId: A.classId, termId: A.termId }, data: { teacherId: subjectTeacher.id } }); // the class's subject lesson is theirs
    expect(await tabs(subjectTeacher)).toEqual(['overview']);
    await prisma.subjectAssignment.updateMany({ where: { classId: A.classId, termId: A.termId }, data: { teacherId: A.users.TEACHER.id } });
    expect(await tabs(A.users.TEACHER)).toEqual(['overview', 'guardians', 'discipline']);
  });
});

describe('profile tabs', () => {
  it('shows birth certificate numbers and special needs notes only to those who may see them, and finds siblings through a shared guardian', async () => {
    const a = await addStudent(prisma, A, { phone: '+263772555001' });
    const b = await addStudent(prisma, A, { phone: '+263772555001' }); // same guardian
    await prisma.student.update({ where: { id: a.id }, data: { birthCertificateNumber: '63123456A42', specialNeeds: true, specialNeedsNote: 'Needs front-row seat' } });
    const admin = (await call('students/[id]', 'GET', { as: A.operator!, params: { id: a.id } })).json.data.overview;
    expect(admin).toMatchObject({ birthCertificateNumber: '63-123456 A 42', specialNeedsNote: 'Needs front-row seat' });
    expect(admin.siblings.map((x: { id: string }) => x.id)).toEqual([b.id]);
    const subjectTeacher = await userWithRoles(prisma, A, ['TEACHER'], 'subject-teacher-2');
    await prisma.subjectAssignment.updateMany({ where: { classId: A.classId, termId: A.termId }, data: { teacherId: subjectTeacher.id } });
    const teacher = (await call('students/[id]', 'GET', { as: subjectTeacher, params: { id: a.id } })).json.data.overview;
    await prisma.subjectAssignment.updateMany({ where: { classId: A.classId, termId: A.termId }, data: { teacherId: A.users.TEACHER.id } });
    expect(teacher.birthCertificateNumber).toBeNull();
    expect(teacher.hasBirthCertificate).toBe(true);
    expect(teacher.specialNeedsNote).toBeNull();
    expect(teacher.primaryGuardian).toBeNull(); // no students.guardians.view
  });

  it('shows guardians with their flags, hides ID numbers without students.guardians.view_ids, and lists their other children', async () => {
    const a = await addStudent(prisma, A, { phone: '+263772555002' });
    const b = await addStudent(prisma, A, { phone: '+263772555002', classId: form2East });
    await prisma.guardian.updateMany({ where: { schoolId: A.schoolId, phone: '+263772555002' }, data: { nationalId: '63-111111 X 11' } });
    await prisma.studentGuardian.updateMany({ where: { studentId: a.id }, data: { isFeePayer: true, canCollect: true, custodyNote: 'Collect with ID' } });
    const open = (as: { id: string }) => call('students/[id]/guardians', 'GET', { as: as as never, params: { id: a.id } });
    expect((await open(A.users.BURSAR)).status).toBe(403);
    const full = (await open(A.operator!)).json.data.guardians[0];
    expect(full).toMatchObject({ isPrimary: true, isFeePayer: true, canCollect: true, custodyNote: 'Collect with ID', nationalId: '63-111111 X 11', hasNationalId: true });
    expect(full.otherChildren).toEqual([{ id: b.id, fullName: b.fullName, className: 'Form 2 East' }]);
    await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.guardians.view', 'CLASS');
    const masked = (await open(A.users.TEACHER)).json.data.guardians[0];
    expect(masked.nationalId).toBeNull();
    expect(masked.hasNationalId).toBe(true);
    expect(JSON.stringify(masked)).not.toContain('63-111111');
  });

  it('shows the class history by term and the class moves with their reasons and approvers', async () => {
    const s = await addStudent(prisma, A);
    await call('students/move', 'POST', { as: A.operator!, body: { move: { studentIds: [s.id], toClassId: form2East, reason: 'SUBJECT_COMBINATION' } } });
    const r = await call('students/[id]/enrolment', 'GET', { as: A.operator!, params: { id: s.id } });
    expect(r.status).toBe(200);
    expect(r.json.data.admission).toMatchObject({ admissionNumber: s.admissionNumber });
    expect(r.json.data.history).toMatchObject([{ term: 'Term 1 2026', className: 'Form 2 East', status: 'ACTIVE' }]);
    expect(r.json.data.moves).toMatchObject([{ from: 'Form 1 North', to: 'Form 2 East', reason: 'Subject combination', status: 'APPROVED', approvedBy: A.operator!.fullName }]);
    expect((await call('students/[id]/enrolment', 'GET', { as: A.users.TEACHER, params: { id: s.id } })).status).toBe(403);
  });

  it("shows this student's audit log to those who may see the audit log, newest first, and hides medical entries from those without medical access", async () => {
    const s = await addStudent(prisma, A);
    await call('students/[id]', 'PATCH', { as: A.operator!, params: { id: s.id }, body: { nationality: 'Zambian' } });
    await call('students/[id]/medical', 'GET', { as: A.operator!, params: { id: s.id } });
    const act = (as: { id: string }) => call('students/[id]/activity', 'GET', { as: as as never, params: { id: s.id } });
    expect((await act(A.users.BURSAR)).status).toBe(403);
    const all = (await act(A.operator!)).json.data;
    const actions = all.entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['MEDICAL_VIEWED', 'UPDATE_STUDENT']));
    expect(all.entries.map((e: { at: string }) => e.at)).toEqual([...all.entries.map((e: { at: string }) => e.at)].sort().reverse());
    expect(all.entries.every((e: { actor: string }) => e.actor === A.operator!.fullName || e.actor.length > 0)).toBe(true);
    await grantPermission(prisma, A.schoolId, 'TEACHER', 'system.audit.view');
    const limited = (await act(A.users.TEACHER)).json.data.entries.map((e: { action: string }) => e.action);
    expect(limited).not.toContain('MEDICAL_VIEWED');
    expect(limited).toContain('UPDATE_STUDENT');
  });
});

// ─── Add student ─────────────────────────────────────────────────────────────

const guardian = (over: Record<string, unknown> = {}) => ({ fullName: 'Rudo Maposa', relationship: 'MOTHER', phone: '0772 345 678', isPrimary: true, isFeePayer: true, ...over });
const student = (over: Record<string, unknown> = {}) => ({
  firstName: 'tafadzwa', surname: "o'neil-moyo", gender: 'M', dateOfBirth: `${Y - 13}-04-02`, classId: A.classId, entryType: 'NEW_FORM_1', admissionDate: dayOffset(-1),
  guardians: [guardian()], ...over,
});
const add = (as: { id: string } | null, s: Record<string, unknown>, acknowledgedWarnings: string[] = []) => call('students', 'POST', { as: as as never, body: { student: s, acknowledgedWarnings } });
const count = () => prisma.student.count({ where: { schoolId: A.schoolId } });

describe('adding a student: who and what', () => {
  it('needs students.profiles.create', async () => {
    expect((await add(A.users.BURSAR, student())).status).toBe(403);
    expect((await add(null, student())).status).toBe(401);
  });

  it('saves the student, the enrollment in the open term and the guardian, and generates the admission number', async () => {
    const before = await count();
    const r = await add(A.operator!, student({
      preferredName: 'Tafi', birthCertificateNumber: '63-654321 a 42', nationality: 'Zimbabwean', homeLanguage: 'Shona', religion: 'None',
      boarding: 'BOARDER', isBeam: true, sponsorName: 'Old Mutual', orphanStatus: 'SINGLE', specialNeeds: true, specialNeedsNote: 'Hearing aid',
      entryResults: { grade7Units: 9 }, address: '12 Mbare Rd, Harare',
    }));
    expect(r.status, r.text).toBe(201);
    expect(await count()).toBe(before + 1);
    expect(r.json.data.student.admissionNumber).toMatch(/^MHS\d{4}\d{4}$/);
    const s = await prisma.student.findUniqueOrThrow({ where: { id: r.json.data.student.id }, include: { enrollments: true, guardians: { include: { guardian: true } } } });
    expect(s).toMatchObject({
      firstName: 'Tafadzwa', surname: "O'Neil-Moyo", fullName: "Tafadzwa O'Neil-Moyo", preferredName: 'Tafi', gender: 'M', birthCertificateNumber: '63654321A42', nationality: 'Zimbabwean',
      homeLanguage: 'Shona', boarding: 'BOARDER', isBeam: true, sponsorName: 'Old Mutual', orphanStatus: 'SINGLE', specialNeeds: true, specialNeedsNote: 'Hearing aid',
      entryType: 'NEW_FORM_1', status: 'ACTIVE', currentClassId: A.classId, address: '12 Mbare Rd, Harare', entryResults: { grade7Units: 9 },
    });
    expect(s.enrollments).toHaveLength(1);
    expect(s.enrollments[0]).toMatchObject({ termId: A.termId, classId: A.classId, status: 'ACTIVE' });
    expect(s.guardians[0]).toMatchObject({ isPrimary: true, isFeePayer: true, canReceiveSms: true, canCollect: true, relationship: 'MOTHER' });
    expect(s.guardians[0]!.guardian).toMatchObject({ fullName: 'Rudo Maposa', phone: '+263772345678' });
    expect(await prisma.libraryMember.count({ where: { studentId: s.id } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'ADMIT_STUDENT', entityId: s.id } });
    expect(audit.actorId).toBe(A.operator!.id);
    expect(audit.after).toMatchObject({ entryType: 'NEW_FORM_1', guardians: 1 });
  });

  it('numbers students one after another from the school format', async () => {
    const a = await add(A.operator!, student({ firstName: 'Anesu', dateOfBirth: `${Y - 13}-01-01` }));
    const b = await add(A.operator!, student({ firstName: 'Brian', dateOfBirth: `${Y - 13}-01-02`, guardians: [guardian({ phone: '0772345679', fullName: 'Other Person' })] }));
    const n = (r: typeof a) => Number(r.json.data.student.admissionNumber.slice(-4));
    expect(n(b)).toBe(n(a) + 1);
  });
});

describe('adding a student: what is checked', () => {
  const bad = async (over: Record<string, unknown>) => add(A.operator!, student(over), ['POSSIBLE_DUPLICATE']);

  it('rejects bad names, gender, dates and certificate numbers with a message for the field', async () => {
    const before = await count();
    const cases: [Record<string, unknown>, string][] = [
      [{ firstName: 'T' }, 'firstName'], [{ firstName: 'Tafa123' }, 'firstName'], [{ surname: '' }, 'surname'], [{ gender: 'X' }, 'gender'],
      [{ dateOfBirth: dayOffset(3) }, 'dateOfBirth'], [{ dateOfBirth: `${Y - 13}-02-30` }, 'dateOfBirth'], [{ birthCertificateNumber: '12345' }, 'birthCertificateNumber'],
      [{ admissionDate: '1990-01-01' }, 'admissionDate'], [{ admissionDate: `${Y - 14}-01-01` }, 'admissionDate'], [{ entryType: 'WALK_IN' }, 'entryType'],
      [{ photoUrl: 'https://evil.example/photo.png' }, 'photoUrl'], [{ entryResults: { grade7Units: 2 } }, 'entryResults'],
    ];
    for (const [over, field] of cases) {
      const r = await bad(over);
      expect(r.status, JSON.stringify(over)).toBe(422);
      expect(Object.keys(r.json.errors).map((k) => k.split('.')[0]), JSON.stringify(over)).toContain(field);
    }
    expect(await count()).toBe(before);
  });

  it('requires the previous school for a transfer in or Lower 6, and a note for special needs', async () => {
    expect((await bad({ entryType: 'TRANSFER_IN' })).status).toBe(422);
    expect((await bad({ entryType: 'NEW_LOWER_6' })).status).toBe(422);
    expect((await bad({ specialNeeds: true })).status).toBe(422);
  });

  it('requires at least one guardian, exactly one primary, and valid phone numbers', async () => {
    expect((await bad({ guardians: [] })).status).toBe(422);
    expect((await bad({ guardians: [guardian({ isPrimary: false })] })).status).toBe(422);
    expect((await bad({ guardians: [guardian(), guardian({ phone: '0773111222', fullName: 'Second Person' })] })).status).toBe(422);
    expect((await bad({ guardians: [guardian({ phone: '12345' })] })).status).toBe(422);
    expect((await bad({ guardians: [guardian({ phone: '' })] })).status).toBe(422);
    expect((await bad({ guardians: [guardian({ fullName: 'Madonna' })] })).status).toBe(422);
    expect((await bad({ guardians: [guardian({ phone2: '0772345678' })] })).status).toBe(422);
    expect((await bad({ guardians: [guardian({ relationship: 'OTHER' })] })).status).toBe(422);
    expect((await bad({ guardians: [guardian({ relationship: 'FRIEND' })] })).status).toBe(422);
  });

  it('refuses a class, house or guardian that belongs to another school or is not in use', async () => {
    expect((await bad({ classId: B.classId })).status).toBe(404);
    expect((await bad({ classId: 'nope' })).status).toBe(404);
    const theirHouse = await prisma.house.create({ data: { schoolId: B.schoolId, name: 'Theirs' } });
    expect((await bad({ houseId: theirHouse.id })).status).toBe(404);
    const theirGuardian = await prisma.guardian.create({ data: { schoolId: B.schoolId, fullName: 'Their Guardian', phone: '+263773000999' } });
    expect((await bad({ guardians: [{ existingGuardianId: theirGuardian.id, relationship: 'FATHER', isPrimary: true }] })).status).toBe(404);
    const closed = await addClass(prisma, A, 'Form 3 Closed', { order: 3 });
    await prisma.schoolClass.update({ where: { id: closed.id }, data: { active: false } });
    expect((await bad({ classId: closed.id })).status).toBe(409);
  });
});

describe('adding a student: warnings, duplicates and shared guardians', () => {
  it('warns about an unusual age and saves only when the warning was accepted', async () => {
    const r1 = await add(A.operator!, student({ firstName: 'Elder', dateOfBirth: `${Y - 21}-01-01` }));
    expect(r1.status).toBe(409);
    expect(r1.json.message).toContain('years old');
    expect((await add(A.operator!, student({ firstName: 'Elder', dateOfBirth: `${Y - 21}-01-01` }), ['AGE_OUT_OF_RANGE'])).status).toBe(201);
  });

  it('warns when the class is full and says what the size will become', async () => {
    const tiny = await addClass(prisma, A, 'Form 3 Tiny', { capacity: 1, order: 3 });
    await addStudent(prisma, A, { classId: tiny.id });
    const r = await add(A.operator!, student({ firstName: 'Late', dateOfBirth: `${Y - 15}-05-05`, classId: tiny.id, entryType: 'TRANSFER_IN', previousSchool: 'Goromonzi High' }));
    expect(r.status).toBe(409);
    expect(r.json.message).toContain('capacity is 1');
    expect((await add(A.operator!, student({ firstName: 'Late', dateOfBirth: `${Y - 15}-05-05`, classId: tiny.id, entryType: 'TRANSFER_IN', previousSchool: 'Goromonzi High' }), ['CLASS_FULL', 'AGE_OUT_OF_RANGE'])).status).toBeLessThan(500);
  });

  it('warns about the same name and date of birth, with the match, and lets the person save anyway', async () => {
    const first = await add(A.operator!, student({ firstName: 'Twin', surname: 'Sibling', dateOfBirth: `${Y - 13}-07-07` }));
    expect(first.status).toBe(201);
    const dup = student({ firstName: 'twin', surname: 'SIBLING', dateOfBirth: `${Y - 13}-07-07`, guardians: [guardian({ phone: '0773555000', fullName: 'Another Parent' })] });
    const refused = await add(A.operator!, dup);
    expect(refused.status).toBe(409);
    expect(refused.json.message).toContain('same name and date of birth');
    const check = await call('students/check', 'POST', { as: A.operator!, body: dup });
    expect(check.json.data.possibleDuplicates[0]).toMatchObject({ id: first.json.data.student.id, admissionNumber: first.json.data.student.admissionNumber });
    expect(check.json.data.warnings.map((w: { code: string }) => w.code)).toContain('POSSIBLE_DUPLICATE');
    expect((await add(A.operator!, dup, ['POSSIBLE_DUPLICATE'])).status).toBe(201);
  });

  it('never saves the same birth certificate number twice, whatever was accepted', async () => {
    const a = await add(A.operator!, student({ firstName: 'Cert', dateOfBirth: `${Y - 13}-08-01`, birthCertificateNumber: '75-998877 B 13' }));
    expect(a.status).toBe(201);
    const dup = student({ firstName: 'Other', surname: 'Child', dateOfBirth: `${Y - 13}-08-02`, birthCertificateNumber: '75998877b13' });
    const r = await add(A.operator!, dup, ['POSSIBLE_DUPLICATE', 'AGE_OUT_OF_RANGE', 'CLASS_FULL']);
    expect(r.status).toBe(409);
    expect(r.json.message).toContain(a.json.data.student.admissionNumber);
    const check = await call('students/check', 'POST', { as: A.operator!, body: dup });
    expect(check.json.data.certificateMatch).toMatchObject({ id: a.json.data.student.id });
  });

  it('shares one guardian record between siblings, keeping the first record', async () => {
    const a = await add(A.operator!, student({ firstName: 'Older', dateOfBirth: `${Y - 14}-03-03`, guardians: [guardian({ phone: '0771888000', fullName: 'Shared Parent' })] }));
    const check = await call('students/check', 'POST', { as: A.operator!, body: student({ firstName: 'Younger', dateOfBirth: `${Y - 13}-03-03`, guardians: [guardian({ phone: '+263 771 888 000', fullName: 'Shared Pat' })] }) });
    expect(check.json.data.guardianMatches).toMatchObject([{ phone: '+263771888000', fullName: 'Shared Parent', children: [{ id: a.json.data.student.id, className: 'Form 1 North' }] }]);
    const b = await add(A.operator!, student({ firstName: 'Younger', dateOfBirth: `${Y - 13}-03-03`, guardians: [guardian({ phone: '+263 771 888 000', fullName: 'Shared Pat' })] }));
    expect(b.status).toBe(201);
    expect(await prisma.guardian.count({ where: { schoolId: A.schoolId, phone: '+263771888000' } })).toBe(1);
    const links = await prisma.studentGuardian.findMany({ where: { guardian: { phone: '+263771888000' } } });
    expect(links).toHaveLength(2);
    expect((await prisma.guardian.findFirstOrThrow({ where: { schoolId: A.schoolId, phone: '+263771888000' } })).fullName).toBe('Shared Parent');
  });

  it('links a guardian found by phone, with the flags chosen for this student', async () => {
    const g = await prisma.guardian.findFirstOrThrow({ where: { schoolId: A.schoolId, phone: '+263771888000' } });
    const r = await add(A.operator!, student({ firstName: 'Third', dateOfBirth: `${Y - 13}-09-09`, guardians: [{ existingGuardianId: g.id, relationship: 'FATHER', isPrimary: true, isFeePayer: false, receivesSms: false, canCollect: false, custodyNote: 'Court order: mother only' }] }));
    expect(r.status).toBe(201);
    const link = await prisma.studentGuardian.findUniqueOrThrow({ where: { studentId_guardianId: { studentId: r.json.data.student.id, guardianId: g.id } } });
    expect(link).toMatchObject({ relationship: 'FATHER', isPrimary: true, isFeePayer: false, canReceiveSms: false, canCollect: false, custodyNote: 'Court order: mother only' });
  });

  it('adds several guardians with exactly one primary contact', async () => {
    const r = await add(A.operator!, student({ firstName: 'Many', dateOfBirth: `${Y - 13}-10-10`, guardians: [
      guardian({ phone: '0772700001', fullName: 'First Guardian', isPrimary: false, isFeePayer: false }),
      guardian({ phone: '0772700002', fullName: 'Second Guardian', relationship: 'FATHER', isPrimary: true }),
      guardian({ phone: '0772700003', fullName: 'Third Guardian', relationship: 'UNCLE', isPrimary: false, canCollect: false }),
    ] }));
    expect(r.status).toBe(201);
    const links = await prisma.studentGuardian.findMany({ where: { studentId: r.json.data.student.id }, include: { guardian: true } });
    expect(links).toHaveLength(3);
    expect(links.filter((l) => l.isPrimary).map((l) => l.guardian.fullName)).toEqual(['Second Guardian']);
  });

  it('warns when the entry type does not fit the form', async () => {
    const r = await add(A.operator!, student({ firstName: 'Misfit', dateOfBirth: `${Y - 14}-06-06`, classId: form2East, entryType: 'NEW_FORM_1' }));
    expect(r.status).toBe(409);
    expect(r.json.message).toContain('normally join Form 1');
  });

  it('changes nothing when only checking', async () => {
    const before = await count();
    const check = await call('students/check', 'POST', { as: A.operator!, body: student({ firstName: 'Preview', dateOfBirth: `${Y - 13}-11-11` }) });
    expect(check.status).toBe(200);
    expect(check.json.data.admissionNumberPreview).toMatch(/^MHS/);
    expect(await count()).toBe(before);
    expect((await call('students/check', 'POST', { as: A.users.BURSAR, body: student() })).status).toBe(403);
  });
});

describe('a transfer in', () => {
  const transfer = (over: Record<string, unknown> = {}) => student({ firstName: 'Moved', dateOfBirth: `${Y - 14}-02-02`, entryType: 'TRANSFER_IN', previousSchool: 'St Ignatius', classId: form2East, guardians: [guardian({ phone: '0772900001', fullName: 'Transfer Parent' })], ...over });

  it('is approved by the Head: someone who cannot approve admissions is told to ask', async () => {
    await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.profiles.create', 'CLASS');
    const r = await add(A.users.TEACHER, transfer());
    expect(r.status).toBe(403);
    expect(r.json.message).toContain('approved by the Head');
    expect(await prisma.student.count({ where: { schoolId: A.schoolId, firstName: 'Moved' } })).toBe(0);
  });

  it('is saved when the person may approve admissions, and the approver is in the audit entry', async () => {
    const r = await add(A.operator!, transfer());
    expect(r.status).toBe(201);
    const s = await prisma.student.findUniqueOrThrow({ where: { id: r.json.data.student.id } });
    expect(s).toMatchObject({ entryType: 'TRANSFER_IN', previousSchool: 'St Ignatius' });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'ADMIT_STUDENT', entityId: s.id } });
    expect(audit.actorId).toBe(A.operator!.id);
    expect(audit.detail).toContain('Transfer in');
  });
});

// ─── Edit ────────────────────────────────────────────────────────────────────

describe('editing a student', () => {
  const patch = (as: { id: string } | null, id: string, body: Record<string, unknown>) => call('students/[id]', 'PATCH', { as: as as never, params: { id }, body });

  it('needs students.profiles.edit', async () => {
    const s = await addStudent(prisma, A);
    expect((await patch(A.users.BURSAR, s.id, { nationality: 'Zambian' })).status).toBe(403);
    expect((await patch(A.operator!, (await addStudent(prisma, B)).id, { nationality: 'Zambian' })).status).toBe(404);
  });

  it('changes the details, recomputes the full name, and records before and after without private values', async () => {
    const s = await addStudent(prisma, A, { firstName: 'Old', surname: 'Name' });
    const r = await patch(A.operator!, s.id, { firstName: 'new', surname: 'surname', preferredName: 'Nu', birthCertificateNumber: '08 1234567 z 05', specialNeeds: true, specialNeedsNote: 'Secret support plan', isBeam: true, boarding: 'BOARDER' });
    expect(r.status).toBe(200);
    expect(r.json.data.changed).toEqual(expect.arrayContaining(['firstName', 'surname', 'preferredName', 'birthCertificateNumber', 'specialNeeds', 'specialNeedsNote', 'isBeam', 'boarding']));
    const row = await prisma.student.findUniqueOrThrow({ where: { id: s.id } });
    expect(row).toMatchObject({ firstName: 'New', surname: 'Surname', fullName: 'New Surname', preferredName: 'Nu', birthCertificateNumber: '081234567Z05', isBeam: true, boarding: 'BOARDER' });
    expect(row.admissionNumber).toBe(s.admissionNumber);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'UPDATE_STUDENT', entityId: s.id } });
    expect(audit.before).toMatchObject({ firstName: 'Old', surname: 'Name', isBeam: false, birthCertificateNumber: '[private]' });
    expect(audit.after).toMatchObject({ firstName: 'New', isBeam: true, boarding: 'BOARDER', specialNeedsNote: '[private]' });
    const text = JSON.stringify(await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, entityId: s.id } }));
    expect(text).not.toContain('Secret support plan');
    expect(text).not.toContain('081234567Z05');
  });

  it('cannot change the admission number, status or class: those have their own actions', async () => {
    const s = await addStudent(prisma, A);
    for (const body of [{ admissionNumber: 'X1' }, { status: 'WITHDRAWN' }, { currentClassId: form2East }, { classId: form2East }, { schoolId: B.schoolId }]) {
      expect((await patch(A.operator!, s.id, body)).status, JSON.stringify(body)).toBe(422);
    }
    const row = await prisma.student.findUniqueOrThrow({ where: { id: s.id } });
    expect(row).toMatchObject({ admissionNumber: s.admissionNumber, status: 'ACTIVE', currentClassId: A.classId, schoolId: A.schoolId });
  });

  it('checks the certificate number, the house, special needs and the dates', async () => {
    const a = await addStudent(prisma, A);
    const b = await addStudent(prisma, A);
    expect((await patch(A.operator!, a.id, { birthCertificateNumber: '75-111111 A 11' })).status).toBe(200);
    expect((await patch(A.operator!, b.id, { birthCertificateNumber: '75111111a11' })).status).toBe(409);
    expect((await patch(A.operator!, b.id, { birthCertificateNumber: 'abc' })).status).toBe(422);
    expect((await patch(A.operator!, a.id, { birthCertificateNumber: null })).status).toBe(200); // can be cleared
    const theirHouse = await prisma.house.create({ data: { schoolId: B.schoolId, name: 'Elsewhere' } });
    expect((await patch(A.operator!, a.id, { houseId: theirHouse.id })).status).toBe(404);
    expect((await patch(A.operator!, a.id, { specialNeeds: true })).status).toBe(422);
    expect((await patch(A.operator!, a.id, { dateOfBirth: dayOffset(5) })).status).toBe(422);
    expect((await patch(A.operator!, a.id, { dateOfBirth: dayOffset(-1) })).status).toBe(422); // after the admission date
    expect((await patch(A.operator!, a.id, {})).status).toBe(422);
  });

  it('does nothing, and logs nothing, when nothing changes', async () => {
    const s = await addStudent(prisma, A, { firstName: 'Same', surname: 'Person' });
    const before = await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'UPDATE_STUDENT', entityId: s.id } });
    const r = await patch(A.operator!, s.id, { firstName: 'Same', gender: 'M' });
    expect(r.json.data.changed).toEqual([]);
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'UPDATE_STUDENT', entityId: s.id } })).toBe(before);
  });
});

// ─── Guardians ───────────────────────────────────────────────────────────────

describe('guardians of a student', () => {
  const addG = (as: { id: string } | null, id: string, body: Record<string, unknown>) => call('students/[id]/guardians', 'POST', { as: as as never, params: { id }, body });
  const patchG = (as: { id: string }, id: string, guardianId: string, body: Record<string, unknown>) => call('students/[id]/guardians/[guardianId]', 'PATCH', { as: as as never, params: { id, guardianId }, body });

  it('need students.guardians.edit to add, link and change', async () => {
    const s = await addStudent(prisma, A);
    expect((await addG(A.users.BURSAR, s.id, { fullName: 'New Person', phone: '0772100001', relationship: 'AUNT' })).status).toBe(403);
    await grantPermission(prisma, A.schoolId, 'BURSAR', 'students.guardians.view');
    expect((await addG(A.users.BURSAR, s.id, { fullName: 'New Person', phone: '0772100001', relationship: 'AUNT' })).status).toBe(403); // viewing is not editing
  });

  it('are found by phone first, with the children already at the school and no ID number', async () => {
    const g = await prisma.guardian.findFirstOrThrow({ where: { schoolId: A.schoolId, phone: '+263771888000' } });
    await prisma.guardian.update({ where: { id: g.id }, data: { nationalId: '99-999999 Q 99' } });
    const r = await call('students/guardians/lookup', 'GET', { as: A.operator!, query: '?phone=0771%20888%20000' });
    expect(r.status).toBe(200);
    expect(r.json.data.guardian).toMatchObject({ guardianId: g.id, fullName: 'Shared Parent', phone: '+263771888000' });
    expect(r.json.data.guardian.children.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(r.json)).not.toContain('99-999999');
    expect((await call('students/guardians/lookup', 'GET', { as: A.operator!, query: '?phone=0771000000' })).json.data.guardian).toBeNull();
    expect((await call('students/guardians/lookup', 'GET', { as: A.operator!, query: '?phone=abc' })).json.data.guardian).toBeNull();
    expect((await call('students/guardians/lookup', 'GET', { as: A.users.BURSAR, query: '?phone=0771888000' })).status).toBe(403);
    expect((await call('students/guardians/lookup', 'GET', { as: B.operator!, query: '?phone=0771888000' })).json.data.guardian).toBeNull(); // another school's guardians are invisible
  });

  it('adds a new guardian, or reuses the record that owns the phone number', async () => {
    const s = await addStudent(prisma, A);
    const r = await addG(A.operator!, s.id, { fullName: 'aunt grace', phone: '0772100002', phone2: '0772100003', relationship: 'AUNT', canCollect: true, custodyNote: 'Weekends only' });
    expect(r.status).toBe(201);
    const links = await prisma.studentGuardian.findMany({ where: { studentId: s.id }, include: { guardian: true } });
    expect(links).toHaveLength(2);
    expect(links.find((l) => l.relationship === 'AUNT')).toMatchObject({ isPrimary: false, custodyNote: 'Weekends only', guardian: { fullName: 'Aunt Grace', phone: '+263772100002', altPhone: '+263772100003' } });
    // the same phone for another student reuses the record
    const s2 = await addStudent(prisma, A);
    await addG(A.operator!, s2.id, { fullName: 'Someone Else', phone: '0772100002', relationship: 'AUNT' });
    expect(await prisma.guardian.count({ where: { schoolId: A.schoolId, phone: '+263772100002' } })).toBe(1);
    // linking twice is refused
    expect((await addG(A.operator!, s2.id, { fullName: 'Someone Else', phone: '0772100002', relationship: 'AUNT' })).status).toBe(409);
  });

  it('links an existing guardian by id, never one from another school', async () => {
    const s = await addStudent(prisma, A);
    const mine = await prisma.guardian.findFirstOrThrow({ where: { schoolId: A.schoolId, phone: '+263772100002' } });
    expect((await addG(A.operator!, s.id, { guardianId: mine.id, relationship: 'GUARDIAN' })).status).toBe(201);
    const theirs = await prisma.guardian.create({ data: { schoolId: B.schoolId, fullName: 'Theirs', phone: '+263772100999' } });
    expect((await addG(A.operator!, s.id, { guardianId: theirs.id, relationship: 'GUARDIAN' })).status).toBe(404);
  });

  it('keep exactly one primary contact, and keep at least one guardian', async () => {
    const s = await addStudent(prisma, A);
    await addG(A.operator!, s.id, { fullName: 'Second Person', phone: '0772100010', relationship: 'FATHER' });
    const links = await prisma.studentGuardian.findMany({ where: { studentId: s.id }, include: { guardian: true } });
    const second = links.find((l) => l.guardian.fullName === 'Second Person')!;
    expect((await patchG(A.operator!, s.id, second.guardianId, { link: { makePrimary: true } })).status).toBe(200);
    expect((await prisma.studentGuardian.findMany({ where: { studentId: s.id, isPrimary: true } })).map((l) => l.guardianId)).toEqual([second.guardianId]);
    const first = links.find((l) => l !== second)!;
    // the primary cannot be removed, the other can, and then the last one stays
    const del = (gid: string) => call('students/[id]/guardians/[guardianId]', 'DELETE', { as: A.operator!, params: { id: s.id, guardianId: gid } });
    expect((await del(second.guardianId)).status).toBe(409);
    expect((await del(first.guardianId)).status).toBe(200);
    expect((await del(second.guardianId)).status).toBe(409);
    expect(await prisma.studentGuardian.count({ where: { studentId: s.id } })).toBe(1);
  });

  it('can change the flags for one student without touching the shared record', async () => {
    const g = await prisma.guardian.findFirstOrThrow({ where: { schoolId: A.schoolId, phone: '+263771888000' } });
    const links = await prisma.studentGuardian.findMany({ where: { guardianId: g.id } });
    const [one, two] = links;
    expect((await patchG(A.operator!, one!.studentId, g.id, { link: { receivesSms: false, canCollect: false, custodyNote: 'Do not release', isFeePayer: true } })).status).toBe(200);
    expect(await prisma.studentGuardian.findUniqueOrThrow({ where: { studentId_guardianId: { studentId: one!.studentId, guardianId: g.id } } })).toMatchObject({ canReceiveSms: false, canCollect: false, custodyNote: 'Do not release' });
    expect(await prisma.studentGuardian.findUniqueOrThrow({ where: { studentId_guardianId: { studentId: two!.studentId, guardianId: g.id } } })).toMatchObject({ custodyNote: two!.custodyNote });
  });

  it('cannot take over a phone number that belongs to another guardian', async () => {
    const g = await prisma.guardian.findFirstOrThrow({ where: { schoolId: A.schoolId, phone: '+263772100010' } });
    const link = await prisma.studentGuardian.findFirstOrThrow({ where: { guardianId: g.id } });
    expect((await patchG(A.operator!, link.studentId, g.id, { guardian: { phone: '0771888000' } })).status).toBe(409);
    expect((await patchG(A.operator!, link.studentId, g.id, { guardian: { phone: 'nope' } })).status).toBe(422);
    expect((await patchG(A.operator!, link.studentId, g.id, { guardian: { occupation: 'Teacher', nationalId: '08-123456 a 05' } })).status).toBe(200);
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, entityType: 'Guardian', entityId: g.id } }))).not.toContain('08-123456');
  });
});

// @vitest-environment node
// Medical notes (who sees them, the audit of every view) and documents (private uploads, 10-minute links,
// the required-documents checklist, generated letters with reference numbers).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { addClass, addStudent, dayOffset } from '../helpers/students';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));
vi.mock('@/lib/students/storage', () => ({ signStudentFile: async (key: string, expiresIn: string) => `https://signed.example/${key}?expires=${expiresIn}` }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;

const SECRET_NOTE = 'Carries an EpiPen in the left bag pocket';

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  for (const S of [A, B]) await prisma.academicTerm.update({ where: { id: S.termId }, data: { startDate: new Date(`${dayOffset(-30)}T00:00:00Z`), endDate: new Date(`${dayOffset(60)}T00:00:00Z`) } });
  await prisma.school.update({ where: { id: A.schoolId }, data: { headName: 'Mrs R. Ncube', motto: 'Per ardua' } });
  await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.profiles.view');
  await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.medical.view', 'CLASS');
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

const medical = (as: { id: string } | null, id: string) => call('students/[id]/medical', 'GET', { as: as as never, params: { id } });
const saveMedical = (as: { id: string } | null, id: string, body: Record<string, unknown>) => call('students/[id]/medical', 'PUT', { as: as as never, params: { id }, body });

describe('medical notes: who sees them', () => {
  it('are refused to a user without students.medical.view, however much else they may see', async () => {
    const s = await addStudent(prisma, A);
    expect((await medical(A.users.BURSAR, s.id)).status).toBe(403);
    expect((await medical(null, s.id)).status).toBe(401);
    await grantPermission(prisma, A.schoolId, 'BURSAR', 'students.profiles.view');
    expect((await medical(A.users.BURSAR, s.id)).status).toBe(403);
  });

  it('write an audit entry for every view, not only for changes', async () => {
    const s = await addStudent(prisma, A);
    const count = () => prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'MEDICAL_VIEWED', entityId: s.id } });
    expect(await count()).toBe(0);
    expect((await medical(A.operator!, s.id)).status).toBe(200);
    expect((await medical(A.operator!, s.id)).status).toBe(200);
    expect(await count()).toBe(2);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'MEDICAL_VIEWED', entityId: s.id } });
    expect(entry.actorId).toBe(A.operator!.id);
    expect(entry.module).toBe('students');
    // a refused request leaves no entry because nothing was shown
    await medical(A.users.BURSAR, s.id);
    expect(await count()).toBe(2);
  });

  it('reach only the students the user teaches, and never another school', async () => {
    const elsewhere = await addClass(prisma, A, 'Form 2 East');
    const notMine = await addStudent(prisma, A, { classId: elsewhere.id });
    const mine = await addStudent(prisma, A);
    expect((await medical(A.users.TEACHER, mine.id)).status).toBe(200);
    expect((await medical(A.users.TEACHER, notMine.id)).status).toBe(404);
    expect((await medical(A.operator!, (await addStudent(prisma, B)).id)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'MEDICAL_VIEWED', entityId: notMine.id } })).toBe(0);
  });

  it('can be changed only by someone who may edit them', async () => {
    const s = await addStudent(prisma, A);
    expect((await saveMedical(A.users.TEACHER, s.id, { notes: 'x' })).status).toBe(403); // may view, may not edit
    expect((await saveMedical(A.operator!, s.id, { notes: SECRET_NOTE })).status).toBe(200);
  });
});

describe('medical notes: what is kept', () => {
  const full = {
    conditions: [{ name: 'Asthma' }, { name: 'Other', note: 'Eczema' }],
    allergies: [{ name: 'penicillin', severity: 'SEVERE' }, { name: 'pollen', severity: 'MILD' }],
    medications: [{ name: 'Salbutamol inhaler', dose: '2 puffs', whenGiven: 'When wheezing', keptBy: 'MATRON' }],
    bloodGroup: 'O+',
    medicalAid: { provider: 'CIMAS', number: 'C-1029384', mainMember: 'Mr Banda' },
    doctor: { name: 'Dr Moyo', phone: '+263242123456' },
    emergency: { name: 'Aunt Grace', phone: '+263772000111', relationship: 'Aunt' },
    specialNeeds: { type: 'Dyslexia', supportNeeded: 'Extra time in exams' },
    consent: { emergencyTreatment: true, date: dayOffset(-10) },
    notes: SECRET_NOTE,
  };

  it('keeps everything and shows it back', async () => {
    const s = await addStudent(prisma, A);
    const save = await saveMedical(A.operator!, s.id, full);
    expect(save.status).toBe(200);
    expect(save.json.data.hasSevereAllergy).toBe(true);
    const m = (await medical(A.operator!, s.id)).json.data.medical;
    expect(m).toMatchObject({
      conditions: [{ name: 'Asthma' }, { name: 'Other', note: 'Eczema' }], bloodGroup: 'O+',
      medicalAid: { provider: 'CIMAS', number: 'C-1029384', mainMember: 'Mr Banda' }, doctor: { name: 'Dr Moyo' },
      emergency: { name: 'Aunt Grace', fromPrimaryGuardian: false }, consent: { emergencyTreatment: true, date: dayOffset(-10), hasForm: false }, notes: SECRET_NOTE,
    });
    expect(m.allergies).toHaveLength(2);
    expect(m.medications).toMatchObject([{ name: 'Salbutamol inhaler', keptBy: 'MATRON' }]);
    expect((await prisma.medicalProfile.findUniqueOrThrow({ where: { studentId: s.id } })).hasSevereAllergy).toBe(true);
  });

  it('uses the primary guardian as the emergency contact until another is given', async () => {
    const s = await addStudent(prisma, A);
    const m = (await medical(A.operator!, s.id)).json.data.medical;
    expect(m.emergency).toMatchObject({ fromPrimaryGuardian: true });
    expect(m.emergency.name).toMatch(/^Guardian /);
    expect(m.emergency.phone).toMatch(/^\+263/);
  });

  it('replaces the medication list and clears the severe-allergy flag when the allergy goes', async () => {
    const s = await addStudent(prisma, A);
    await saveMedical(A.operator!, s.id, full);
    await saveMedical(A.operator!, s.id, { allergies: [{ name: 'pollen', severity: 'MILD' }], medications: [] });
    const m = (await medical(A.operator!, s.id)).json.data.medical;
    expect(m.medications).toEqual([]);
    expect((await prisma.medicalProfile.findUniqueOrThrow({ where: { studentId: s.id } })).hasSevereAllergy).toBe(false);
    expect(await prisma.medicationEntry.count({ where: { profile: { studentId: s.id } } })).toBe(0);
  });

  it('checks what was typed', async () => {
    const s = await addStudent(prisma, A);
    const bad = async (body: Record<string, unknown>) => (await saveMedical(A.operator!, s.id, body)).status;
    expect(await bad({ allergies: [{ name: 'nuts' }] })).toBe(422);
    expect(await bad({ allergies: [{ name: 'nuts', severity: 'DEADLY' }] })).toBe(422);
    expect(await bad({ conditions: [{ name: 'Other' }] })).toBe(422);
    expect(await bad({ conditions: [{ name: 'Gout' }] })).toBe(422);
    expect(await bad({ bloodGroup: 'Z+' })).toBe(422);
    expect(await bad({ medications: [{ name: 'x' }] })).toBe(422);
    expect(await bad({ doctor: { phone: 'call me' } })).toBe(422);
    expect(await bad({ consent: { formKey: `sdoc:${B.schoolId}:other` } })).toBe(422);
    expect(await prisma.medicalProfile.count({ where: { studentId: s.id } })).toBe(0);
  });

  it('never puts medical details in the audit log, but does record that they changed', async () => {
    const s = await addStudent(prisma, A);
    await saveMedical(A.operator!, s.id, full);
    await saveMedical(A.operator!, s.id, { ...full, notes: 'A different private note', bloodGroup: 'A+' });
    const rows = await prisma.auditLog.findMany({ where: { schoolId: A.schoolId } });
    const text = JSON.stringify(rows);
    for (const secret of [SECRET_NOTE, 'A different private note', 'penicillin', 'Salbutamol', 'C-1029384', 'Dr Moyo', 'Dyslexia', 'Aunt Grace']) {
      expect(text, secret).not.toContain(secret);
    }
    const entries = await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: 'UPDATE_MEDICAL', entityId: s.id }, orderBy: { createdAt: 'asc' } });
    expect(entries).toHaveLength(2);
    expect(entries[1]!.after).toMatchObject({ changedSections: ['bloodGroup', 'notes'] });
    const rowChanges = await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, entityType: 'MedicalProfile' } });
    expect(rowChanges.length).toBeGreaterThan(0);
    expect(JSON.stringify(rowChanges)).toContain('[hidden');
  });
});

describe('sick bay', () => {
  it('is recorded when the Hostel module is on, with the guardian informed', async () => {
    const s = await addStudent(prisma, A);
    const post = (body: Record<string, unknown>) => call('students/[id]/medical/sick-bay', 'POST', { as: A.operator!, params: { id: s.id }, body });
    const visit = { visitedAt: `${dayOffset(-1)}T09:15`, complaint: 'Headache', treatment: 'Paracetamol', outcome: 'SENT_HOME', guardianInformed: true };
    expect((await post(visit)).status).toBe(201);
    expect((await post({ ...visit, visitedAt: `${dayOffset(2)}T09:15` })).status).toBe(422);
    expect((await post({ ...visit, outcome: 'STAYED' })).status).toBe(422);
    expect((await medical(A.operator!, s.id)).json.data.medical.sickBay).toMatchObject({ enabled: true, visits: [{ complaint: 'Headache', outcome: 'SENT_HOME', guardianInformed: true }] });

    await prisma.schoolModule.upsert({ where: { schoolId_module: { schoolId: A.schoolId, module: 'facilities' } }, update: { enabled: false }, create: { schoolId: A.schoolId, module: 'facilities', enabled: false } });
    expect((await post(visit)).status).toBe(409); // not recorded while the Hostel module is off
    expect((await medical(A.operator!, s.id)).json.data.medical.sickBay).toMatchObject({ enabled: false, visits: [] });
    await prisma.schoolModule.update({ where: { schoolId_module: { schoolId: A.schoolId, module: 'facilities' } }, data: { enabled: true } });
  });
});

// ─── Documents ───────────────────────────────────────────────────────────────

const upload = (as: { id: string } | null, id: string, body: Record<string, unknown>) => call('students/[id]/documents', 'POST', { as: as as never, params: { id }, body });
const docBody = (S: SeededSchool, over: Record<string, unknown> = {}) => ({
  type: 'BIRTH_CERTIFICATE', title: 'Birth certificate scan', fileKey: `sdoc:${S.schoolId}:${Math.random().toString(36).slice(2)}abcd`,
  mimeType: 'application/pdf', sizeBytes: 120_000, ...over,
});

describe('uploading documents', () => {
  it('needs students.documents.upload and a file that belongs to this school', async () => {
    const s = await addStudent(prisma, A);
    expect((await upload(A.users.BURSAR, s.id, docBody(A))).status).toBe(403);
    expect((await upload(A.operator!, s.id, docBody(A, { fileKey: `sdoc:${B.schoolId}:stolenkey123` }))).status).toBe(422);
    expect((await upload(A.operator!, s.id, docBody(A, { fileKey: 'pop:someone:else:12345' }))).status).toBe(422);
    expect((await upload(A.operator!, s.id, docBody(A))).status).toBe(201);
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'UPLOAD_DOCUMENT' } })).toBeGreaterThan(0);
  });

  it('accepts PDF, JPG and PNG up to 5 MB, and nothing else', async () => {
    const s = await addStudent(prisma, A);
    for (const mimeType of ['application/pdf', 'image/jpeg', 'image/png']) expect((await upload(A.operator!, s.id, docBody(A, { mimeType }))).status, mimeType).toBe(201);
    expect((await upload(A.operator!, s.id, docBody(A, { mimeType: 'image/gif' }))).status).toBe(422);
    expect((await upload(A.operator!, s.id, docBody(A, { mimeType: 'application/zip' }))).status).toBe(422);
    expect((await upload(A.operator!, s.id, docBody(A, { sizeBytes: 5 * 1024 * 1024 }))).status).toBe(201);
    expect((await upload(A.operator!, s.id, docBody(A, { sizeBytes: 5 * 1024 * 1024 + 1 }))).status).toBe(422);
    expect((await upload(A.operator!, s.id, docBody(A, { sizeBytes: 0 }))).status).toBe(422);
  });

  it('records the type, title, date, optional expiry, notes and who uploaded it', async () => {
    const s = await addStudent(prisma, A);
    expect((await upload(A.operator!, s.id, docBody(A, { type: 'LETTER_ADMISSION' }))).status).toBe(422); // letters are generated, not uploaded
    expect((await upload(A.operator!, s.id, docBody(A, { title: '' }))).status).toBe(422);
    expect((await upload(A.operator!, s.id, docBody(A, { date: '2026-05-01', expiryDate: '2026-04-01' }))).status).toBe(422);
    expect((await upload(A.operator!, s.id, docBody(A, { type: 'PHOTO_CONSENT', title: 'Photo consent 2026', date: dayOffset(-3), expiryDate: dayOffset(300), notes: 'Signed by mother' }))).status).toBe(201);
    const list = (await call('students/[id]/documents', 'GET', { as: A.operator!, params: { id: s.id } })).json.data;
    expect(list.documents[0]).toMatchObject({ type: 'PHOTO_CONSENT', title: 'Photo consent 2026', notes: 'Signed by mother', uploadedBy: A.operator!.fullName, expired: false, canOpen: true });
  });

  it('is limited to students the user can reach', async () => {
    expect((await upload(A.operator!, (await addStudent(prisma, B)).id, docBody(A))).status).toBe(404);
  });
});

describe('the checklist of required documents', () => {
  it('shows which required documents are missing, expired or present', async () => {
    const s = await addStudent(prisma, A);
    const set = (as: { id: string }, types: string[]) => call('system/settings/documents', 'PUT', { as: as as never, body: { types } });
    expect((await set(A.users.TEACHER, ['BIRTH_CERTIFICATE'])).status).toBe(403);
    expect((await set(A.operator!, ['BIRTH_CERTIFICATE', 'GRADE7_RESULTS_SLIP', 'PHOTO_CONSENT'])).status).toBe(200);
    expect((await set(A.operator!, ['PASSPORT'])).status).toBe(422);
    const check = async () => Object.fromEntries((await call('students/[id]/documents', 'GET', { as: A.operator!, params: { id: s.id } })).json.data.checklist.map((c: { type: string; present: boolean; expired: boolean }) => [c.type, c]));
    expect(await check()).toMatchObject({ BIRTH_CERTIFICATE: { present: false }, GRADE7_RESULTS_SLIP: { present: false }, PHOTO_CONSENT: { present: false } });
    await upload(A.operator!, s.id, docBody(A));
    await upload(A.operator!, s.id, docBody(A, { type: 'PHOTO_CONSENT', title: 'Old consent', date: dayOffset(-400), expiryDate: dayOffset(-5) }));
    expect(await check()).toMatchObject({ BIRTH_CERTIFICATE: { present: true }, GRADE7_RESULTS_SLIP: { present: false }, PHOTO_CONSENT: { present: false, expired: true } });
    await upload(A.operator!, s.id, docBody(A, { type: 'PHOTO_CONSENT', title: 'New consent', expiryDate: dayOffset(200) }));
    expect((await check()).PHOTO_CONSENT).toMatchObject({ present: true, expired: false });
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'UPDATE_SCHOOL_SETTINGS', entityType: 'School' } })).toBeGreaterThan(0);
  });
});

describe('opening a document', () => {
  it('gives a link that expires after 10 minutes and audit-logs the opening', async () => {
    const s = await addStudent(prisma, A);
    const body = docBody(A);
    await upload(A.operator!, s.id, body);
    const doc = await prisma.studentDocument.findFirstOrThrow({ where: { studentId: s.id } });
    const r = await call('students/documents/[docId]/link', 'GET', { as: A.operator!, params: { docId: doc.id } });
    expect(r.status).toBe(200);
    expect(r.json.data.expiresIn).toBe('10m');
    expect(r.json.data.url).toContain(`expires=10m`);
    expect(r.json.data.url).toContain(body.fileKey);
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'VIEW_DOCUMENT', entityId: doc.id } })).toBe(1);
  });

  it('is refused for another school, for users without students.documents.view, and for students they cannot reach', async () => {
    const s = await addStudent(prisma, A);
    await upload(A.operator!, s.id, docBody(A));
    const doc = await prisma.studentDocument.findFirstOrThrow({ where: { studentId: s.id } });
    expect((await call('students/documents/[docId]/link', 'GET', { as: B.operator!, params: { docId: doc.id } })).status).toBe(404);
    expect((await call('students/documents/[docId]/link', 'GET', { as: A.users.BURSAR, params: { docId: doc.id } })).status).toBe(403);
    expect((await call('students/documents/[docId]/link', 'GET', { as: null as never, params: { docId: doc.id } })).status).toBe(401);
    await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.documents.view', 'CLASS');
    const elsewhere = await addClass(prisma, A, 'Form 2 West');
    const far = await addStudent(prisma, A, { classId: elsewhere.id });
    await upload(A.operator!, far.id, docBody(A));
    const farDoc = await prisma.studentDocument.findFirstOrThrow({ where: { studentId: far.id } });
    expect((await call('students/documents/[docId]/link', 'GET', { as: A.users.TEACHER, params: { docId: farDoc.id } })).status).toBe(404);
    expect((await call('students/documents/[docId]/link', 'GET', { as: A.users.TEACHER, params: { docId: doc.id } })).status).toBe(200);
  });

  it('keeps guardian ID scans and medical reports behind their own permissions', async () => {
    await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.documents.view', 'CLASS');
    const s = await addStudent(prisma, A);
    await upload(A.operator!, s.id, docBody(A, { type: 'GUARDIAN_ID', title: 'Mother ID' }));
    await upload(A.operator!, s.id, docBody(A, { type: 'MEDICAL_REPORT', title: 'Clinic report' }));
    const docs = await prisma.studentDocument.findMany({ where: { studentId: s.id } });
    const id = docs.find((d) => d.type === 'GUARDIAN_ID')!;
    const med = docs.find((d) => d.type === 'MEDICAL_REPORT')!;
    const open = async (docId: string) => (await call('students/documents/[docId]/link', 'GET', { as: A.users.TEACHER, params: { docId } })).status;
    const canOpen = async () => Object.fromEntries((await call('students/[id]/documents', 'GET', { as: A.users.TEACHER, params: { id: s.id } })).json.data.documents.map((d: { type: string; canOpen: boolean }) => [d.type, d.canOpen]));

    // the teacher may view medical details but not ID numbers
    expect(await canOpen()).toEqual({ GUARDIAN_ID: false, MEDICAL_REPORT: true });
    expect(await open(id.id)).toBe(403);
    expect(await open(med.id)).toBe(200);

    await prisma.rolePermission.deleteMany({ where: { schoolId: A.schoolId, permissionKey: 'students.medical.view', role: { key: 'TEACHER' } } });
    expect(await canOpen()).toEqual({ GUARDIAN_ID: false, MEDICAL_REPORT: false });
    expect(await open(med.id)).toBe(403);

    await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.guardians.view_ids', 'CLASS');
    expect(await open(id.id)).toBe(200);
    await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.medical.view', 'CLASS');
    expect(await open(med.id)).toBe(200);
  });
});

// ─── Letters ─────────────────────────────────────────────────────────────────

const letter = (as: { id: string } | null, id: string, body: Record<string, unknown>) => call('students/[id]/letters', 'POST', { as: as as never, params: { id }, body });

describe('generated letters', () => {
  it('need students.documents.generate', async () => {
    const s = await addStudent(prisma, A);
    expect((await letter(A.users.TEACHER, s.id, { type: 'LETTER_PROOF_OF_ENROLMENT' })).status).toBe(403);
    expect((await letter(null, s.id, { type: 'LETTER_PROOF_OF_ENROLMENT' })).status).toBe(401);
  });

  it('get a reference number that counts up in each school, and are filed on the Documents tab', async () => {
    const s = await addStudent(prisma, A);
    const year = dayOffset(0).slice(0, 4);
    const a = await letter(A.operator!, s.id, { type: 'LETTER_ADMISSION', reportingDate: dayOffset(14) });
    const b = await letter(A.operator!, s.id, { type: 'LETTER_PROOF_OF_ENROLMENT', purpose: 'Embassy visa application' });
    expect(a.status).toBe(201);
    expect(a.json.data.referenceNo).toMatch(new RegExp(`^ADM-${year}-\\d{5}$`));
    expect(b.json.data.referenceNo).toMatch(new RegExp(`^POE-${year}-\\d{5}$`));
    const n = (r: { json: { data: { referenceNo: string } } }) => Number(r.json.data.referenceNo.split('-')[2]);
    expect(n(b)).toBe(n(a) + 1);
    const other = await letter(B.operator!, (await addStudent(prisma, B)).id, { type: 'LETTER_ADMISSION', reportingDate: dayOffset(14) });
    expect(n(other)).toBe(1); // another school has its own sequence
    const docs = (await call('students/[id]/documents', 'GET', { as: A.operator!, params: { id: s.id } })).json.data.documents;
    expect(docs.filter((d: { generated: boolean }) => d.generated).map((d: { referenceNo: string }) => d.referenceNo).sort()).toEqual([a.json.data.referenceNo, b.json.data.referenceNo].sort());
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'GENERATE_LETTER', entityType: 'StudentDocument' } })).toBeGreaterThanOrEqual(2);
  });

  it('check what each letter needs', async () => {
    const s = await addStudent(prisma, A);
    expect((await letter(A.operator!, s.id, { type: 'LETTER_ADMISSION' })).status).toBe(422); // reporting date
    expect((await letter(A.operator!, s.id, { type: 'LETTER_ADMISSION', reportingDate: 'next week' })).status).toBe(422);
    expect((await letter(A.operator!, s.id, { type: 'LETTER_TESTIMONIAL' })).status).toBe(422); // conduct
    expect((await letter(A.operator!, s.id, { type: 'LETTER_TRANSFER', conduct: 'Good' })).status).toBe(409); // no leaving process
    expect((await letter(A.operator!, s.id, { type: 'LETTER_LEAVING_CERTIFICATE' })).status).toBe(409);
    expect((await letter(A.operator!, s.id, { type: 'LETTER_OFFER' })).status).toBe(422); // offers come from admissions
    expect((await letter(A.operator!, (await addStudent(prisma, B)).id, { type: 'LETTER_PROOF_OF_ENROLMENT' })).status).toBe(404);
  });

  it('give a proof of enrolment only to a student enrolled in a class this term', async () => {
    const gone = await addStudent(prisma, A, { status: 'WITHDRAWN' });
    expect((await letter(A.operator!, gone.id, { type: 'LETTER_PROOF_OF_ENROLMENT' })).status).toBe(409);
  });

  it('are printed again exactly as issued, and can be verified by their reference number', async () => {
    const s = await addStudent(prisma, A, { firstName: 'Tadiwa', surname: 'Zvobgo' });
    const made = await letter(A.operator!, s.id, { type: 'LETTER_TESTIMONIAL', conduct: 'Exemplary', activities: 'Chess club', positions: 'Class monitor' });
    expect(made.status).toBe(201);
    const ref = made.json.data.referenceNo as string;
    const doc = await prisma.studentDocument.findFirstOrThrow({ where: { referenceNo: ref } });
    expect(doc.generated).toBe(true);
    expect(doc.snapshot).toMatchObject({ referenceNo: ref, school: { name: 'School A', headName: 'Mrs R. Ncube' }, student: { fullName: 'Tadiwa Zvobgo' }, body: { conduct: 'Exemplary', positions: 'Class monitor' } });

    // The school changes its name and the student changes class; the saved letter does not.
    await prisma.school.update({ where: { id: A.schoolId }, data: { name: 'School A Renamed' } });
    const pdf = await call('students/documents/[docId]/pdf', 'GET', { as: A.operator!, params: { docId: doc.id } });
    expect(pdf.status).toBe(200);
    expect(pdf.response.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.response.headers.get('content-disposition')).toContain(ref);
    expect(pdf.text.startsWith('%PDF')).toBe(true);
    expect((await prisma.studentDocument.findUniqueOrThrow({ where: { id: doc.id } })).snapshot).toMatchObject({ school: { name: 'School A' } });
    await prisma.school.update({ where: { id: A.schoolId }, data: { name: 'School A' } });

    const ok = await call('students/documents/verify', 'GET', { as: A.operator!, query: `?ref=${ref.toLowerCase()}` });
    expect(ok.json.data).toMatchObject({ valid: true, referenceNo: ref, typeLabel: 'Testimonial', studentName: 'Tadiwa Zvobgo' });
    expect((await call('students/documents/verify', 'GET', { as: A.operator!, query: '?ref=TES-2026-99999' })).json.data.valid).toBe(false);
    expect((await call('students/documents/verify', 'GET', { as: B.operator!, query: `?ref=${ref}` })).json.data.valid).toBe(false); // another school cannot see it
    expect((await call('students/documents/[docId]/pdf', 'GET', { as: B.operator!, params: { docId: doc.id } })).status).toBe(404);
    expect((await call('students/documents/[docId]/pdf', 'GET', { as: A.users.BURSAR, params: { docId: doc.id } })).status).toBe(403);
  });
});

describe('finishing a leaving files the right letter', () => {
  const finish = async (S: SeededSchool, studentId: string, body: Record<string, unknown>, conduct?: string) => {
    const start = await call('students/leaving', 'POST', { as: S.operator!, body: { studentId, lastDay: dayOffset(0), ...body } });
    const id = start.json.data.exit.id;
    await call('students/leaving/[id]', 'POST', { as: S.operator!, params: { id }, body: { action: 'approve', overrideReason: 'Clearance done on paper' } });
    return call('students/leaving/[id]', 'POST', { as: S.operator!, params: { id }, body: { action: 'complete', conduct } });
  };

  it('is a transfer letter for a transfer, with the Head words for conduct', async () => {
    const s = await addStudent(prisma, A);
    const r = await finish(A, s.id, { reason: 'TRANSFER', destinationSchool: 'Goromonzi High', destinationDistrict: 'Goromonzi' }, 'Hardworking and polite');
    expect(r.status).toBe(200);
    expect(r.json.data.letter.referenceNo).toMatch(/^TRF-/);
    const doc = await prisma.studentDocument.findFirstOrThrow({ where: { studentId: s.id, type: 'LETTER_TRANSFER' } });
    expect(doc.snapshot).toMatchObject({ body: { conduct: 'Hardworking and polite', destinationSchool: 'Goromonzi High', className: 'Form 1 North' } });
  });

  it('is a leaving certificate with the reason for everyone else, and nothing for a student who has died', async () => {
    const s = await addStudent(prisma, A);
    const r = await finish(A, s.id, { reason: 'COMPLETED_O_LEVEL' });
    expect(r.json.data.letter.referenceNo).toMatch(/^LVC-/);
    expect((await prisma.studentDocument.findFirstOrThrow({ where: { studentId: s.id } })).snapshot).toMatchObject({ body: { reason: 'Completed O Level' } });
    const died = await addStudent(prisma, A);
    const r2 = await finish(A, died.id, { reason: 'DECEASED' });
    expect(r2.status).toBe(200);
    expect(r2.json.data.letter).toBeNull();
    expect(await prisma.studentDocument.count({ where: { studentId: died.id } })).toBe(0);
  });

  it('does not invent a conduct statement when none is given', async () => {
    const s = await addStudent(prisma, A);
    await finish(A, s.id, { reason: 'TRANSFER', destinationSchool: 'Goromonzi High', destinationDistrict: 'Goromonzi' });
    const doc = await prisma.studentDocument.findFirstOrThrow({ where: { studentId: s.id, type: 'LETTER_TRANSFER' } });
    expect((doc.snapshot as { body: { conduct: string } }).body.conduct).toBe('No disciplinary record at this school');
  });
});

// @vitest-environment node
// Uploads (proof of payment: private, typed, size-limited, signed URLs) and the audit trail
// (every create / update / delete of the core tables, with before and after JSON).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { session } from '../helpers/session';

const utapi = vi.hoisted(() => ({ generateSignedURL: vi.fn() }));

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));
vi.mock('uploadthing/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('uploadthing/server')>()),
  UTApi: class {
    generateSignedURL = utapi.generateSignedURL;
  },
}));

let t: TestDb;
let A: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A', { operator: true });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

// ─── Proof-of-payment uploads ────────────────────────────────────────────────

describe('proof-of-payment upload rules', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getRoute = async (): Promise<any> => (await import('@/lib/upload-router')).fileRouter.proofOfPayment;
  const file = (type: string, size = 1000) => ({ name: 'proof', type, size });
  const runMiddleware = async (files: ReturnType<typeof file>[]) =>
    (await getRoute()).middleware({ files, req: new Request('http://localhost'), input: undefined });

  it('accepts only JPEG, PNG, WebP and PDF, stored privately', async () => {
    const config = (await getRoute()).routerConfig;
    expect(Object.keys(config).sort()).toEqual(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
    for (const rule of Object.values(config) as { acl: string; maxFileCount: number }[]) {
      expect(rule.acl).toBe('private');
      expect(rule.maxFileCount).toBe(1);
    }
  });

  it('refuses other file types', async () => {
    session.current = { ...A.users.BURSAR };
    for (const type of ['image/gif', 'image/svg+xml', 'application/zip', 'text/html', 'application/x-msdownload', 'video/mp4']) {
      await expect(runMiddleware([file(type)])).rejects.toThrow(/Only JPG, PNG, WebP or PDF/);
    }
  });

  it('allows exactly 5 MB and refuses one byte more', async () => {
    session.current = { ...A.users.BURSAR };
    await expect(runMiddleware([file('application/pdf', 5 * 1024 * 1024)])).resolves.toBeDefined();
    await expect(runMiddleware([file('application/pdf', 5 * 1024 * 1024 + 1)])).rejects.toThrow(/5 MB/);
  });

  it('requires a signed-in user', async () => {
    session.current = null;
    await expect(runMiddleware([file('image/png')])).rejects.toThrow(/Unauthorized/);
  });

  it("names the file after the school so it can only be attached to that school's payments", async () => {
    session.current = { ...A.users.BURSAR };
    const out = await runMiddleware([file('image/png')]);
    const symbol = Object.getOwnPropertySymbols(out)[0];
    expect(out[symbol][0].customId).toMatch(new RegExp(`^pop:${A.schoolId}:`));
    expect(out.schoolId).toBe(A.schoolId);
  });
});

describe('private proof of payment is opened only through short-lived signed URLs', () => {
  it('stores the key on the payment and never a public URL', async () => {
    const popKey = `pop:${A.schoolId}:11111111-1111-1111-1111-111111111111`;
    const r = await call('accounting/payments', 'POST', {
      as: A.users.BURSAR,
      body: { studentId: A.studentId, currency: 'USD', amount: 15, method: 'ECOCASH', reference: 'EC123', feeLabel: 'Tuition', paidInZig: false, popKey },
    });
    expect(r.status).toBe(201);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: r.json.data.payment.id } });
    expect(row.popKey).toBe(popKey);
    expect(row.popUrl).toBeNull();
  });

  it("refuses another school's key", async () => {
    const r = await call('accounting/payments', 'POST', {
      as: A.users.BURSAR,
      body: { studentId: A.studentId, currency: 'USD', amount: 15, method: 'ECOCASH', reference: 'EC124', feeLabel: 'Tuition', paidInZig: false, popKey: 'pop:someOtherSchool:abc' },
    });
    expect(r.status).toBe(422);
  });

  it('hands out a signed URL that expires in minutes', async () => {
    const popKey = `pop:${A.schoolId}:22222222-2222-2222-2222-222222222222`;
    const p = await prisma.payment.create({
      data: { schoolId: A.schoolId, studentId: A.studentId, currency: 'USD', amount: 5, method: 'ZIPIT', feeLabel: 'Tuition', recordedBy: A.users.BURSAR.id, popKey },
    });
    utapi.generateSignedURL.mockResolvedValueOnce({ ufsUrl: 'https://utfs.io/f/signed?expires=1' });
    const r = await call('accounting/payments/[id]/proof', 'GET', { as: A.users.BURSAR, params: { id: p.id } });
    expect(r.status).toBe(200);
    expect(r.json.data.url).toBe('https://utfs.io/f/signed?expires=1');
    expect(r.json.data.expiresIn).toBe('5m');
    expect(utapi.generateSignedURL).toHaveBeenCalledWith(popKey, { keyType: 'customId', expiresIn: '5m' });
  });

  it('only people who handle payments may ask for it', async () => {
    const p = await prisma.payment.findFirstOrThrow({ where: { popKey: { not: null } } });
    for (const role of ['TEACHER', 'LIBRARIAN'] as const) {
      expect((await call('accounting/payments/[id]/proof', 'GET', { as: A.users[role], params: { id: p.id } })).status).toBe(403);
    }
    expect((await call('accounting/payments/[id]/proof', 'GET', { as: null, params: { id: p.id } })).status).toBe(401);
  });

  it('refuses a key that does not carry the school id, even if it is in the database', async () => {
    const p = await prisma.payment.create({
      data: { schoolId: A.schoolId, studentId: A.studentId, currency: 'USD', amount: 5, method: 'ZIPIT', feeLabel: 'Tuition', recordedBy: A.users.BURSAR.id, popKey: 'pop:evil:333' },
    });
    utapi.generateSignedURL.mockClear();
    expect((await call('accounting/payments/[id]/proof', 'GET', { as: A.users.BURSAR, params: { id: p.id } })).status).toBe(404);
    expect(utapi.generateSignedURL).not.toHaveBeenCalled();
  });

  it('proofs uploaded before the change (public URLs) still open', async () => {
    const p = await prisma.payment.create({
      data: { schoolId: A.schoolId, studentId: A.studentId, currency: 'USD', amount: 5, method: 'ZIPIT', feeLabel: 'Tuition', recordedBy: A.users.BURSAR.id, popUrl: 'https://utfs.io/f/old-proof.png' },
    });
    const r = await call('accounting/payments/[id]/proof', 'GET', { as: A.users.BURSAR, params: { id: p.id } });
    expect(r.json.data.url).toBe('https://utfs.io/f/old-proof.png');
  });

  it('404s when a payment has no proof', async () => {
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: A.paymentId } });
    expect(p.popKey).toBeNull();
    expect((await call('accounting/payments/[id]/proof', 'GET', { as: A.users.BURSAR, params: { id: p.id } })).status).toBe(404);
  });
});

// ─── Audit trail ─────────────────────────────────────────────────────────────

const rowsFor = (entityType: string, entityId: string, action?: string) =>
  prisma.auditLog.findMany({
    where: { entityType, entityId, ...(action ? { action: action as never } : { action: { in: ['DATA_CREATE', 'DATA_UPDATE', 'DATA_DELETE'] } }) },
    orderBy: { createdAt: 'asc' },
  });

describe('every create, update and delete of the core tables is audited with before/after JSON', () => {
  it('Payment: recording one', async () => {
    const r = await call('accounting/payments', 'POST', {
      as: A.users.BURSAR,
      body: { studentId: A.studentId, currency: 'USD', amount: 42, method: 'CASH', feeLabel: 'Levy', paidInZig: false },
    });
    const id = r.json.data.payment.id;
    const [row] = await rowsFor('Payment', id);
    expect(row.action).toBe('DATA_CREATE');
    expect(row.actorId).toBe(A.users.BURSAR.id);
    expect(row.schoolId).toBe(A.schoolId);
    expect(row.before).toBeNull();
    expect(row.after).toMatchObject({ amount: 42, feeLabel: 'Levy', status: 'VERIFIED', recordedBy: A.users.BURSAR.id });
  });

  it('Payment: verifying one records the status change', async () => {
    const p = await prisma.payment.create({
      data: { schoolId: A.schoolId, studentId: A.studentId, currency: 'USD', amount: 7, method: 'ECOCASH', reference: 'X', feeLabel: 'Levy', recordedBy: A.users.DIRECTOR.id },
    });
    await call('accounting/payments/[id]/verify', 'POST', { as: A.users.BURSAR, params: { id: p.id } });
    const rows = await rowsFor('Payment', p.id);
    expect(rows.map((x) => x.action)).toEqual(['DATA_UPDATE']);
    expect(rows[0].before).toMatchObject({ status: 'PENDING', verifiedBy: null });
    expect(rows[0].after).toMatchObject({ status: 'VERIFIED', verifiedBy: A.users.BURSAR.id });
    // and the business-level entry still exists next to it
    expect(await rowsFor('Payment', p.id, 'VERIFY_PAYMENT')).toHaveLength(1);
  });

  it('Charge', async () => {
    const r = await call('accounting/students/[id]/charges', 'POST', {
      as: A.users.BURSAR, params: { id: A.studentId }, body: { studentId: A.studentId, label: 'Sports levy', currency: 'USD', amount: 12, termId: A.termId },
    });
    const [row] = await rowsFor('Charge', r.json.data.charge.id);
    expect(row.action).toBe('DATA_CREATE');
    expect(row.after).toMatchObject({ label: 'Sports levy', amount: 12, studentId: A.studentId });
  });

  it('Expense: recording and voiding', async () => {
    const r = await call('accounting/expenses', 'POST', {
      as: A.users.BURSAR, body: { category: 'Stationery', currency: 'USD', amount: 30, spentOn: '2026-10-01' },
    });
    const id = r.json.data.expense.id;
    await call('accounting/expenses/[id]/void', 'POST', { as: A.users.DIRECTOR, params: { id } });
    const rows = await rowsFor('Expense', id);
    expect(rows.map((x) => x.action)).toEqual(['DATA_CREATE', 'DATA_UPDATE']);
    expect(rows[1].before).toMatchObject({ status: 'ACTIVE', voidedBy: null });
    expect(rows[1].after).toMatchObject({ status: 'VOIDED', voidedBy: A.users.DIRECTOR.id });
  });

  it('Mark: entering and then changing a mark keeps the old value', async () => {
    await prisma.mark.deleteMany({ where: { id: A.markId } });
    const body = { studentId: A.studentId, subjectId: A.subjectId, classId: A.classId, termId: A.termId };
    const first = await call('results/marks', 'POST', { as: A.users.TEACHER, body: { ...body, rawMark: 55 } });
    expect(first.status).toBe(200);
    const id = first.json.data.mark.id;
    await call('results/marks', 'POST', { as: A.users.TEACHER, body: { ...body, rawMark: 65 } });
    const rows = await rowsFor('Mark', id);
    expect(rows.map((x) => x.action)).toEqual(['DATA_CREATE', 'DATA_UPDATE']);
    expect(rows[1].before).toMatchObject({ rawMark: 55 });
    expect(rows[1].after).toMatchObject({ rawMark: 65 });
    expect(rows[1].actorId).toBe(A.users.TEACHER.id);
  });

  it('Student', async () => {
    await call('accounting/students/[id]', 'PATCH', { as: A.operator!, params: { id: A.studentId }, body: { previousSchool: 'Mbare Primary' } });
    const rows = await rowsFor('Student', A.studentId);
    const last = rows[rows.length - 1];
    expect(last.action).toBe('DATA_UPDATE');
    expect(last.before).toMatchObject({ previousSchool: null });
    expect(last.after).toMatchObject({ previousSchool: 'Mbare Primary' });
  });

  it('Student: private columns are recorded as changed, never as values', async () => {
    const r = await call('students/[id]', 'PATCH', { as: A.operator!, params: { id: A.studentId }, body: { specialNeeds: true, specialNeedsNote: 'Needs a front-row seat', birthCertificateNumber: '63-999999 A 42' } });
    expect(r.status).toBe(200);
    const rows = await rowsFor('Student', A.studentId);
    const last = rows[rows.length - 1];
    expect(last.after).toMatchObject({ specialNeedsNote: '[hidden, changed]', birthCertificateNumber: '[hidden, changed]' });
    expect(JSON.stringify(rows)).not.toContain('front-row');
    expect(JSON.stringify(rows)).not.toContain('63999999A42');
  });

  it('The student fee statement never carries medical, ID or portal-link details', async () => {
    const r = await call('accounting/students/[id]', 'GET', { as: A.users.BURSAR, params: { id: A.studentId } });
    expect(r.status).toBe(200);
    for (const field of ['medicalNotes', 'birthCertificateNumber', 'portalTokenHash', 'portalPinHash', 'portalToken', 'specialNeedsNote']) {
      expect(Object.keys(r.json.data.student), field).not.toContain(field);
    }
  });

  it('Guardian (and student admission creates Student, Guardian and Enrollment rows)', async () => {
    const r = await call('admin/students/[id]/guardians', 'POST', {
      as: A.operator!, params: { id: A.studentId }, body: { fullName: 'Uncle Tendai', phone: '0772223333', relationship: 'UNCLE' },
    });
    expect(r.status).toBe(201);
    const guardianId = r.json.data.guardian?.id ?? r.json.data.guardianId;
    const rows = await rowsFor('Guardian', guardianId);
    expect(rows[0]).toMatchObject({ action: 'DATA_CREATE' });
    expect(rows[0].after).toMatchObject({ fullName: 'Uncle Tendai' });
  });

  it('Enrollment: moving a student to another class', async () => {
    const other = await prisma.schoolClass.create({ data: { schoolId: A.schoolId, name: 'Form 1 South', levelId: A.levelId, stream: 'South' } });
    const r = await call('admin/students/move', 'POST', { as: A.operator!, body: { studentIds: [A.studentId], classId: other.id } });
    expect(r.status).toBe(200);
    const enrollment = await prisma.enrollment.findFirstOrThrow({ where: { studentId: A.studentId, termId: A.termId } });
    const rows = await rowsFor('Enrollment', enrollment.id);
    const last = rows[rows.length - 1];
    expect(last.action).toBe('DATA_UPDATE');
    expect(last.before).toMatchObject({ classId: A.classId });
    expect(last.after).toMatchObject({ classId: other.id });
  });

  it('User: creating, changing role, resetting a password — and never any password hash', async () => {
    const created = await call('admin/users', 'POST', { as: A.operator!, body: { fullName: 'Audit Me', email: 'auditme@schoola.test', role: 'TEACHER' } });
    const id = created.json.data.user.id;
    await call('admin/users/[id]', 'PATCH', { as: A.operator!, params: { id }, body: { role: 'BURSAR' } });
    await call('admin/users/[id]/reset-password', 'POST', { as: A.operator!, params: { id } });
    const rows = await rowsFor('User', id);
    expect(rows.map((x) => x.action)).toEqual(['DATA_CREATE', 'DATA_UPDATE', 'DATA_UPDATE']);
    expect(rows[1].before).toMatchObject({ role: 'TEACHER' });
    expect(rows[1].after).toMatchObject({ role: 'BURSAR' });
    const everything = JSON.stringify(rows);
    expect(everything).not.toMatch(/passwordHash/);
    expect(everything).not.toMatch(/\$2[aby]\$/);
  });

  it('deletes are recorded too (the old row is kept in "before")', async () => {
    const { getScopedDb } = await import('@/lib/scoped-db');
    const db = getScopedDb(A.schoolId, A.operator!.id);
    const c = await db.charge.create({ data: { studentId: A.studentId, termId: A.termId, label: 'Mistake', currency: 'USD', amount: 1 } as never });
    await db.charge.delete({ where: { id: c.id } });
    const rows = await rowsFor('Charge', c.id);
    expect(rows.map((x) => x.action)).toEqual(['DATA_CREATE', 'DATA_DELETE']);
    expect(rows[1].before).toMatchObject({ label: 'Mistake' });
    expect(rows[1].after).toBeNull();
  });

  it('the log cannot be edited or removed afterwards', async () => {
    const row = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.deleteMany({ where: { id: row.id } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(prisma.auditLog.updateMany({ where: { id: row.id }, data: { detail: 'tampered' } })).rejects.toThrow(/cannot be changed or deleted/);
  });
});

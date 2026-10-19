// @vitest-environment node
// Separation of duties, enforced by the API routes (not just hidden buttons).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

const newPayment = (recordedBy: string, status: 'PENDING' | 'VERIFIED' = 'PENDING') =>
  prisma.payment.create({
    data: { schoolId: A.schoolId, studentId: A.studentId, currency: 'USD', amount: 20, method: 'ECOCASH', feeLabel: 'Tuition', status, recordedBy },
  });

const newRequest = (requestedById: string, over: Record<string, unknown> = {}) =>
  prisma.expenseRequest.create({
    data: {
      schoolId: A.schoolId, requestNumber: `REQ-T-${Math.random().toString(36).slice(2, 8)}`, title: 'Paper', type: 'OTHER',
      department: 'Admin', justification: 'Need it', currency: 'USD', estimatedTotal: 10, status: 'PENDING', requestedById, ...over,
    },
  });

const newExpense = (recordedBy: string) =>
  prisma.expense.create({ data: { schoolId: A.schoolId, category: 'Fuel', currency: 'USD', amount: 9, spentOn: new Date(), recordedBy } });

describe('verify a payment', () => {
  it('refuses the person who recorded it, with a clear message, and leaves it pending', async () => {
    const p = await newPayment(A.users.HEAD.id);
    const r = await call('accounting/payments/[id]/verify', 'POST', { as: A.users.HEAD, params: { id: p.id } });
    expect(r.status).toBe(403);
    expect(r.json.message).toBe('You recorded this payment, so someone else must verify it.');
    expect((await prisma.payment.findUnique({ where: { id: p.id } }))?.status).toBe('PENDING');
  });

  it('lets another authorised person verify it', async () => {
    const p = await newPayment(A.users.BURSAR.id);
    const r = await call('accounting/payments/[id]/verify', 'POST', { as: A.users.HEAD, params: { id: p.id } });
    expect(r.status).toBe(200);
    const row = await prisma.payment.findUnique({ where: { id: p.id } });
    expect(row?.status).toBe('VERIFIED');
    expect(row?.verifiedBy).toBe(A.users.HEAD.id);
  });

  it('still enforces the role (a bursar cannot verify at all)', async () => {
    const p = await newPayment(A.users.HEAD.id);
    const r = await call('accounting/payments/[id]/verify', 'POST', { as: A.users.BURSAR, params: { id: p.id } });
    expect(r.status).toBe(403);
  });
});

describe('approve or reject an expense request', () => {
  it('refuses the requester for approve and reject', async () => {
    const req = await newRequest(A.users.HEAD.id);
    const approve = await call('accounting/requests/[id]/approve', 'POST', { as: A.users.HEAD, params: { id: req.id } });
    expect(approve.status).toBe(403);
    expect(approve.json.message).toBe('You raised this request, so someone else must approve it.');
    const reject = await call('accounting/requests/[id]/reject', 'POST', {
      as: A.users.HEAD, params: { id: req.id }, body: { reason: 'Changed my mind about this' },
    });
    expect(reject.status).toBe(403);
    expect(reject.json.message).toBe('You raised this request, so someone else must reject it.');
    expect((await prisma.expenseRequest.findUnique({ where: { id: req.id } }))?.status).toBe('PENDING');
  });

  it('lets someone else approve and reject', async () => {
    const one = await newRequest(A.users.HEAD.id);
    expect((await call('accounting/requests/[id]/approve', 'POST', { as: A.users.DIRECTOR, params: { id: one.id } })).status).toBe(200);
    const two = await newRequest(A.users.HEAD.id);
    const rej = await call('accounting/requests/[id]/reject', 'POST', {
      as: A.users.DIRECTOR, params: { id: two.id }, body: { reason: 'Not in this term budget' },
    });
    expect(rej.status).toBe(200);
  });
});

describe('disburse an expense request', () => {
  const body = { actualTotal: 10, paymentMethod: 'CASH' };

  it('refuses the requester', async () => {
    const req = await newRequest(A.users.BURSAR.id, { status: 'APPROVED', approvedById: A.users.HEAD.id });
    const r = await call('accounting/requests/[id]/disburse', 'POST', { as: A.users.BURSAR, params: { id: req.id }, body });
    expect(r.status).toBe(403);
    expect(r.json.message).toBe('You raised this request, so someone else must disburse it.');
  });

  it('refuses the approver', async () => {
    const req = await newRequest(A.users.BURSAR.id, { status: 'APPROVED', approvedById: A.users.HEAD.id });
    const r = await call('accounting/requests/[id]/disburse', 'POST', { as: A.users.HEAD, params: { id: req.id }, body });
    expect(r.status).toBe(403);
    expect(r.json.message).toBe('You approved this request, so someone else must disburse it.');
    expect((await prisma.expenseRequest.findUnique({ where: { id: req.id } }))?.status).toBe('APPROVED');
  });

  it('allows a third person, and records the expense', async () => {
    const req = await newRequest(A.users.TEACHER.id, { status: 'APPROVED', approvedById: A.users.HEAD.id });
    const r = await call('accounting/requests/[id]/disburse', 'POST', { as: A.users.BURSAR, params: { id: req.id }, body });
    expect(r.status).toBe(200);
    expect((await prisma.expense.count({ where: { expenseRequestId: req.id } }))).toBe(1);
  });
});

describe('void a payment or expense', () => {
  it('lets a director void something somebody else recorded, no reason needed', async () => {
    const p = await newPayment(A.users.BURSAR.id, 'VERIFIED');
    const r = await call('accounting/payments/[id]/void', 'POST', { as: A.users.DIRECTOR, params: { id: p.id } });
    expect(r.status).toBe(200);
    expect((await prisma.payment.findUnique({ where: { id: p.id } }))?.voidedBy).toBe(A.users.DIRECTOR.id);
  });

  it('sole director voiding their own payment: refused without a reason, allowed with one, and audited', async () => {
    const p = await newPayment(A.users.DIRECTOR.id, 'VERIFIED');
    const noReason = await call('accounting/payments/[id]/void', 'POST', { as: A.users.DIRECTOR, params: { id: p.id } });
    expect(noReason.status).toBe(403);
    expect(noReason.json.message).toMatch(/only director/);
    expect((await prisma.payment.findUnique({ where: { id: p.id } }))?.status).toBe('VERIFIED');

    const ok = await call('accounting/payments/[id]/void', 'POST', {
      as: A.users.DIRECTOR, params: { id: p.id }, body: { reason: 'Recorded against the wrong student' },
    });
    expect(ok.status).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'VOID_WITHOUT_SECOND_APPROVER', entityId: p.id } });
    expect(audit?.detail).toMatch(/wrong student/);
  });

  it('sole director voiding their own expense follows the same rule', async () => {
    const e = await newExpense(A.users.DIRECTOR.id);
    const noReason = await call('accounting/expenses/[id]/void', 'POST', { as: A.users.DIRECTOR, params: { id: e.id } });
    expect(noReason.status).toBe(403);
    const ok = await call('accounting/expenses/[id]/void', 'POST', {
      as: A.users.DIRECTOR, params: { id: e.id }, body: { reason: 'Duplicate of the fuel receipt' },
    });
    expect(ok.status).toBe(200);
    expect((await prisma.expense.findUnique({ where: { id: e.id } }))?.status).toBe('VOIDED');
  });

  it('with two directors, the recorder may not void their own record — even with a reason', async () => {
    await prisma.user.create({
      data: { schoolId: A.schoolId, fullName: 'Second Director', email: 'director2@schoola.test', role: 'DIRECTOR', passwordHash: 'x' },
    });
    const p = await newPayment(A.users.DIRECTOR.id, 'VERIFIED');
    const r = await call('accounting/payments/[id]/void', 'POST', {
      as: A.users.DIRECTOR, params: { id: p.id }, body: { reason: 'Recorded against the wrong student' },
    });
    expect(r.status).toBe(403);
    expect(r.json.message).toBe('You recorded this payment, so another director must void it.');
    const e = await newExpense(A.users.DIRECTOR.id);
    const re = await call('accounting/expenses/[id]/void', 'POST', {
      as: A.users.DIRECTOR, params: { id: e.id }, body: { reason: 'Duplicate of the fuel receipt' },
    });
    expect(re.status).toBe(403);
    expect(re.json.message).toBe('You recorded this expense, so another director must void it.');
  });

  it('an inactive second director does not count', async () => {
    await prisma.user.updateMany({ where: { email: 'director2@schoola.test' }, data: { active: false } });
    const p = await newPayment(A.users.DIRECTOR.id, 'VERIFIED');
    const r = await call('accounting/payments/[id]/void', 'POST', {
      as: A.users.DIRECTOR, params: { id: p.id }, body: { reason: 'Recorded against the wrong student' },
    });
    expect(r.status).toBe(200);
  });
});

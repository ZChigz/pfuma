// @vitest-environment node
// The Finance API routes, called as real signed-in users: every route asks can() first (401 without a session, 403 without the
// permission), the bodies are validated on the server, and the money flows work end to end through the HTTP layer.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool, type SeededUser } from '../helpers/seed';
import { call } from '../helpers/route';
import { addStudent } from '../helpers/students';
import { addTeacher } from '../helpers/academics';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
let clerk: SeededUser;
let student: string;
let tuition: string;
let general: string;

const asUser = (u: { id: string; fullName: string }, role: SeededUser['role'] = 'TEACHER'): SeededUser => ({ id: u.id, email: `${u.id}@x.test`, schoolId: A.schoolId, role, fullName: u.fullName });

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
  const clerkId = await addTeacher(prisma, A, 'Clerk Chipo', ['ACCOUNTS_CLERK']);
  clerk = asUser({ id: clerkId, fullName: 'Clerk Chipo' });
  student = (await addStudent(prisma, A, { firstName: 'Route', surname: 'Pupil' })).id;
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('every route asks for sign-in and the right permission first', () => {
  const routes: [string, 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', Record<string, string>?][] = [
    ['finance/funds', 'POST'], ['finance/controls', 'PUT'], ['finance/catalog', 'POST'], ['finance/structures', 'POST'], ['finance/billing', 'POST'], ['finance/billing/preview', 'POST'], ['finance/accounts', 'GET'],
    ['finance/sponsors', 'POST'], ['finance/awards', 'POST'], ['finance/plans', 'POST'], ['finance/rates', 'POST'], ['finance/budgets', 'POST'], ['finance/suppliers', 'POST'], ['finance/petty-cash/floats', 'POST'],
    ['finance/cash-up/submit', 'POST'], ['finance/bank/lines/[id]/ignore', 'POST', { id: 'x' }], ['finance/payroll', 'GET'], ['finance/credit/transfer', 'POST'], ['finance/invoices', 'POST'], ['finance/discounts', 'POST'],
    ['finance/payments', 'GET'], ['finance/payments', 'POST'], ['finance/adjustments', 'GET'], ['finance/adjustments', 'POST'], ['finance/refunds', 'GET'], ['finance/refunds', 'POST'],
    ['finance/expenses', 'POST'], ['finance/reports/overview', 'GET'], ['finance/reports/funds', 'GET'], ['finance/reports/cash-up', 'GET'], ['finance/reports/arrears', 'GET'],
    ['finance/reports/expenditure', 'GET'], ['finance/reports/payments', 'GET'],
    ['finance/payments/[id]/verify', 'POST', { id: 'x' }], ['finance/payments/[id]/void', 'POST', { id: 'x' }], ['finance/payments/[id]/reject', 'POST', { id: 'x' }],
    ['finance/payments/[id]/allocate', 'POST', { id: 'x' }], ['finance/charges/[id]/void', 'POST', { id: 'x' }], ['finance/expenses/[id]/void', 'POST', { id: 'x' }],
    ['finance/adjustments/[id]/decide', 'POST', { id: 'x' }], ['finance/refunds/[id]/decide', 'POST', { id: 'x' }], ['finance/refunds/[id]/pay', 'POST', { id: 'x' }],
    ['finance/requests/[id]/decide', 'POST', { id: 'x' }], ['finance/requests/[id]/disburse', 'POST', { id: 'x' }], ['finance/funds/[id]', 'PATCH', { id: 'x' }], ['finance/structures/[id]/approve', 'POST', { id: 'x' }], ['finance/structures/[id]/submit', 'POST', { id: 'x' }], ['finance/catalog/[id]', 'PATCH', { id: 'x' }],
    ['finance/cash-up/[id]/confirm', 'POST', { id: 'x' }], ['finance/cash-up/[id]/sign-off', 'POST', { id: 'x' }], ['finance/plans/[id]/decide', 'POST', { id: 'x' }], ['finance/payroll/[id]/pay', 'POST', { id: 'x' }],
  ];
  for (const [file, method, params] of routes) {
    it(`${method} /api/${file}: 401 without a session`, async () => {
      expect((await call(file, method, { as: null, params, body: method === 'GET' ? undefined : {} })).status).toBe(401);
    });
  }
  // A teacher holds only "raise an expense request": everything else is forbidden.
  for (const [file, method, params] of routes) {
    it(`${method} /api/${file}: 403 for a teacher`, async () => {
      expect((await call(file, method, { as: A.users.TEACHER, params, body: method === 'GET' ? undefined : {} })).status).toBe(403);
    });
  }
  it('lets the clerk record but not verify, void, approve, pay or change set-up', async () => {
    for (const [file, method, params] of [['finance/payments/[id]/verify', 'POST', { id: 'x' }], ['finance/payments/[id]/void', 'POST', { id: 'x' }], ['finance/structures', 'POST'], ['finance/funds', 'POST'],
      ['finance/refunds/[id]/pay', 'POST', { id: 'x' }], ['finance/requests/[id]/decide', 'POST', { id: 'x' }], ['finance/expenses', 'POST']] as [string, 'GET' | 'POST', Record<string, string>?][]) {
      expect((await call(file, method, { as: clerk, params, body: {} })).status, file).toBe(403);
    }
    expect((await call('finance/payments', 'GET', { as: clerk })).status).toBe(200);
  });
});

describe('fees, payments and balances through the API', () => {
  it('sets up fees and charges the students', async () => {
    const funds = await call('finance/funds', 'GET', { as: A.users.BURSAR });
    expect(funds.status).toBe(200);
    tuition = funds.json.data.find((f: { code: string }) => f.code === 'TUITION').id;
    general = funds.json.data.find((f: { code: string }) => f.code === 'GENERAL').id;
    const catalog = await call('finance/catalog', 'GET', { as: A.users.BURSAR });
    const item = catalog.json.data.find((c: { name: string }) => c.name === 'Tuition').id as string;
    const draft = await call('finance/structures', 'POST', { as: A.users.BURSAR, body: {} });
    expect(draft.status).toBe(201);
    const sid = draft.json.data.id as string;
    const bad = await call('finance/structures/[id]/lines', 'POST', { as: A.users.BURSAR, params: { id: sid }, body: { catalogItemId: item, currency: 'USD', amount: '10.005', levelIds: [A.levelId] } });
    expect(bad.status).toBe(422);
    const made = await call('finance/structures/[id]/lines', 'POST', { as: A.users.BURSAR, params: { id: sid }, body: { catalogItemId: item, currency: 'USD', amount: '250.00', levelIds: [A.levelId] } });
    expect(made.status).toBe(201);
    expect((await call('finance/billing', 'POST', { as: A.users.BURSAR, body: {} })).status).toBe(409); // nothing is billed from a draft
    expect((await call('finance/structures/[id]/submit', 'POST', { as: A.users.BURSAR, params: { id: sid } })).status).toBe(200);
    expect((await call('finance/structures/[id]/approve', 'POST', { as: A.users.BURSAR, params: { id: sid } })).status).toBe(403);
    expect((await call('finance/structures/[id]/approve', 'POST', { as: A.users.HEAD, params: { id: sid } })).status).toBe(200);
    const prev = await call('finance/billing/preview', 'POST', { as: A.users.BURSAR, body: {} });
    expect(prev.json.data.totals.find((t: { currency: string }) => t.currency === 'USD').net).toBeGreaterThan(0);
    const applied = await call('finance/billing', 'POST', { as: A.users.BURSAR, body: {} });
    expect(applied.status).toBe(201);
    expect(applied.json.data.charges).toBeGreaterThan(0);
    const again = await call('finance/billing', 'POST', { as: A.users.BURSAR, body: {} });
    expect(again.json.data.charges).toBe(0);
    const list = await call('finance/structures/[id]', 'GET', { as: A.users.BURSAR, params: { id: sid } });
    expect(list.json.data.lines[0].amountCents).toBe(25000);
  });

  it('records a payment that counts only after someone else verifies it', async () => {
    const rec = await call('finance/payments', 'POST', { as: clerk, body: { studentId: student, currency: 'USD', method: 'CASH', lines: [{ fundId: tuition, amount: '100.00' }] } });
    expect(rec.status).toBe(201);
    const id = rec.json.data.payments[0].id as string;
    const bal = async () => (await call('finance/accounts/[studentId]', 'GET', { as: A.users.BURSAR, params: { studentId: student } })).json.data.byCurrency.USD.outstanding as number;
    expect(await bal()).toBe(25000);
    const own = await call('finance/payments/[id]/verify', 'POST', { as: A.users.BURSAR, params: { id } });
    expect(own.status).toBe(200); // the bursar did not record it: the clerk did
    expect(await bal()).toBe(15000);

    const mine = await call('finance/payments', 'POST', { as: A.users.BURSAR, body: { studentId: student, currency: 'USD', method: 'CASH', lines: [{ fundId: tuition, amount: '20.00' }] } });
    const myId = mine.json.data.payments[0].id as string;
    const self = await call('finance/payments/[id]/verify', 'POST', { as: A.users.BURSAR, params: { id: myId } });
    expect(self.status).toBe(403);
    expect(self.json.message).toMatch(/You recorded this payment/);
    expect(await bal()).toBe(15000);

    const rejected = await call('finance/payments/[id]/reject', 'POST', { as: A.users.HEAD, params: { id: myId }, body: { reason: '' } });
    expect(rejected.status).toBe(422);
    const ok = await call('finance/payments/[id]/reject', 'POST', { as: A.users.HEAD, params: { id: myId }, body: { reason: 'Cash was short' } });
    expect(ok.status).toBe(200);
    const listed = await call('finance/payments', 'GET', { as: A.users.HEAD, query: '?status=REJECTED' });
    expect(listed.json.data.rows.map((r: { id: string }) => r.id)).toContain(myId);
    const receipt = await call('finance/payments/[id]', 'GET', { as: A.users.HEAD, params: { id } });
    expect(receipt.json.data.amountCents).toBe(10000);
    expect(receipt.json.data.allocations[0].amountCents).toBe(10000);
    expect((await call('finance/payments/[id]', 'GET', { as: A.users.HEAD, params: { id: 'nope' } })).status).toBe(404);
  });

  it('a malformed body is a 422, not a crash', async () => {
    expect((await call('finance/payments', 'POST', { as: clerk, rawBody: '{nope' })).status).toBe(400);
    expect((await call('finance/payments', 'POST', { as: clerk, body: { studentId: student, currency: 'EUR', method: 'CASH', lines: [] } })).status).toBe(422);
    expect((await call('finance/payments', 'POST', { as: clerk, body: { studentId: student, currency: 'USD', method: 'CASH', lines: [{ fundId: tuition, amount: 12.5555 }] } })).status).toBe(422);
  });
});

describe('spending through the API', () => {
  it('goes raise, approve, pay through three different people', async () => {
    const r = await call('finance/requests', 'POST', {
      as: A.users.TEACHER, body: { title: 'Markers', type: 'PURCHASE_ORDER', department: 'Science', justification: 'Running out of markers', fundId: general, currency: 'USD', items: [{ description: 'Markers', quantity: 5, unit: '3.00' }], submit: true },
    });
    expect(r.status).toBe(201);
    const id = r.json.data.id as string;
    expect((await call('finance/requests/[id]/decide', 'POST', { as: A.users.TEACHER, params: { id }, body: { decision: 'approve' } })).status).toBe(403);
    expect((await call('finance/requests/[id]/decide', 'POST', { as: A.users.HEAD, params: { id }, body: { decision: 'reject' } })).status).toBe(422); // a reason is needed
    expect((await call('finance/requests/[id]/decide', 'POST', { as: A.users.HEAD, params: { id }, body: { decision: 'approve' } })).status).toBe(200);
    expect((await call('finance/requests/[id]/disburse', 'POST', { as: A.users.BURSAR, params: { id }, body: { method: 'CASH', amount: '99.00' } })).json.data).toMatchObject({ needsApproval: true }); // over the margin: an approver must agree first
    const paid = await call('finance/requests/[id]/disburse', 'POST', { as: A.users.BURSAR, params: { id }, body: { method: 'CASH' } });
    expect(paid.status).toBe(200);
    const detail = await call('finance/requests/[id]', 'GET', { as: A.users.TEACHER, params: { id } });
    expect(detail.json.data).toMatchObject({ status: 'DISBURSED', paidCents: 1500 });
    const mine = await call('finance/requests', 'GET', { as: A.users.TEACHER });
    expect(mine.json.data.rows.map((x: { id: string }) => x.id)).toContain(id);
    // a direct expense by the bursar, and its void by someone else
    const e = await call('finance/expenses', 'POST', { as: A.users.BURSAR, body: { fundId: general, category: 'Transport', description: 'Bus fare to town', currency: 'USD', amount: '8.00', method: 'CASH' } });
    expect(e.status).toBe(201);
    expect((await call('finance/expenses/[id]/void', 'POST', { as: A.users.DIRECTOR, params: { id: e.json.data.id }, body: { reason: 'Recorded twice by mistake' } })).status).toBe(200);
  });
});

describe('reports through the API, with a spreadsheet only for those who may export', () => {
  it('answers JSON for the reports and CSV for the export permission', async () => {
    const overview = await call('finance/reports/overview', 'GET', { as: A.users.HEAD });
    expect(overview.status).toBe(200);
    expect(overview.json.data.charges.USD.charged).toBeGreaterThan(0);
    const cash = await call('finance/reports/cash-up', 'GET', { as: A.users.HEAD });
    expect(cash.status).toBe(200);
    expect(cash.json.data.receipts[0]).toMatchObject({ method: 'CASH', currency: 'USD', cents: 10000 });
    const funds = await call('finance/reports/funds', 'GET', { as: A.users.HEAD, query: `?fundId=${tuition}` });
    expect(new Set(funds.json.data.rows.map((r: { fundId: string }) => r.fundId))).toEqual(new Set([tuition]));
    expect((await call('finance/reports/funds', 'GET', { as: A.users.HEAD, query: '?from=2026-12-31&to=2026-01-01' })).status).toBe(422);
    expect((await call('finance/reports/funds', 'GET', { as: A.users.HEAD, query: '?fundId=' + 'x'.repeat(100) })).status).toBe(422);

    const csv = await call('finance/reports/arrears', 'GET', { as: A.users.BURSAR, query: '?format=csv' });
    expect(csv.status).toBe(200);
    expect(csv.response.headers.get('content-type')).toContain('text/csv');
    expect(csv.text).toContain('Admission number,Student,Class,Currency,Charged');
    expect(csv.text).toMatch(/,USD,250\.00,0\.00,100\.00,0\.00,150\.00/);
    const pay = await call('finance/reports/payments', 'GET', { as: A.users.BURSAR, query: '?format=csv' });
    expect(pay.text).toContain('Receipt,Date,Admission number');
    // the clerk can see reports? no: reports are for those holding finance.reports.view
    expect((await call('finance/reports/cash-up', 'GET', { as: clerk })).status).toBe(403);
    // the Head can look but the export permission is separate: the Head holds it, the teacher does not
    expect((await call('finance/reports/arrears', 'GET', { as: A.users.TEACHER, query: '?format=csv' })).status).toBe(403);
  });
});

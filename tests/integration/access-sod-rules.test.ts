// @vitest-environment node
// The ten separation-of-duties rules, one section each, driven through the real services. Every rule is tried three ways: by a
// person who holds exactly the permissions the two steps need, by the Owner and by the Administrator. The rules are about
// identity ("you did the first step, so someone else must do the second"), so a role that holds everything is not an exception.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, userWithRoles, type SeededSchool } from '../helpers/seed';
import { actorOf } from '../helpers/academics';
import { financeWorld, type FinanceWorld } from '../helpers/finance';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let W: FinanceWorld;
let prisma: typeof import('@/lib/prisma').prisma;
let m: {
  payments: typeof import('@/lib/finance/payments');
  expenses: typeof import('@/lib/finance/expenses');
  fees: typeof import('@/lib/finance/fees');
  requests: typeof import('@/lib/finance/requests');
  adjustments: typeof import('@/lib/finance/adjustments');
  refunds: typeof import('@/lib/finance/refunds');
  discounts: typeof import('@/lib/finance/discounts');
  plans: typeof import('@/lib/finance/plans');
  sponsors: typeof import('@/lib/finance/sponsors');
  cashup: typeof import('@/lib/finance/cashup');
  finPayroll: typeof import('@/lib/finance/payroll');
  setup: typeof import('@/lib/finance/setup');
};

type Actor = FinanceWorld['owner'];
let counter = 0;

/** A person whose only permissions are `keys`, through a custom role: the ordinary holder of those two steps. */
async function holder(keys: string[]): Promise<Actor> {
  const n = ++counter;
  const key = `SOD_HOLDER_${'X'.repeat(n)}`;
  const role = await prisma.roleDefinition.create({ data: { schoolId: A.schoolId, key, name: `SoD holder ${n}`, description: 'Test role', isSystem: false } });
  await prisma.rolePermission.createMany({ data: keys.map((permissionKey) => ({ schoolId: A.schoolId, roleId: role.id, permissionKey, scope: 'SCHOOL' as const })) });
  const person = await userWithRoles(prisma, A, [key], `holder${n}`);
  return actorOf(prisma, person.id);
}


/**
 * The Owner and the Administrator no longer hold "*", so neither holds both steps of a rule on its own. The way one person comes to hold
 * both is an exception (a time-limited grant of the missing permissions), so that is how they are given them here: the rules are about
 * identity, and an exception must not be a way round them.
 */
async function exceptionally(person: Actor, keys: string[]): Promise<Actor> {
  const missing = keys.filter((k) => !(person.grants ?? []).includes(k));
  if (!missing.length) return person;
  await prisma.userPermissionOverride.createMany({
    data: missing.map((permissionKey) => ({ schoolId: A.schoolId, userId: person.id, permissionKey, effect: 'GRANT' as const, reason: 'Separation-of-duties test', expiresAt: new Date(Date.now() + 80 * 86_400_000), createdById: A.users.HEAD.id })),
    skipDuplicates: true,
  });
  return actorOf(prisma, person.id);
}

/** The three people each rule is tried with. */
const people = (keys: string[]) =>
  [
    ['a person holding just these permissions', () => holder(keys)],
    ['the Owner', () => exceptionally(W.owner, keys)],
    ['the Administrator', () => exceptionally(W.admin, keys)],
  ] as const;

const blocked = async (p: Promise<unknown>, match: RegExp) => {
  const e = await p.then(() => null, (x) => x as { status?: number; message: string });
  expect(e, 'the second step should have been refused').not.toBeNull();
  expect(e!.status).toBe(403);
  expect(e!.message).toMatch(match);
};

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  const [payments, expenses, fees, requests, adjustments, refunds, discounts, plans, sponsors, cashup, finPayroll, setup] = await Promise.all([
    import('@/lib/finance/payments'), import('@/lib/finance/expenses'), import('@/lib/finance/fees'), import('@/lib/finance/requests'),
    import('@/lib/finance/adjustments'), import('@/lib/finance/refunds'), import('@/lib/finance/discounts'), import('@/lib/finance/plans'),
    import('@/lib/finance/sponsors'), import('@/lib/finance/cashup'), import('@/lib/finance/payroll'), import('@/lib/finance/setup'),
  ]);
  m = { payments, expenses, fees, requests, adjustments, refunds, discounts, plans, sponsors, cashup, finPayroll, setup };
  A = await seedSchool(prisma, 'School A');
  W = await financeWorld(prisma, A);
  W.funds = Object.fromEntries((await setup.listFunds(W.bursar)).map((f) => [f.code, f.id]));
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

const pay = (a: Actor) => m.payments.recordPayment(a, { studentId: W.students.day1, currency: 'USD', method: 'CASH', lines: [{ fundId: W.funds.GENERAL, amount: `${10 + ++counter}.00` }] }).then((r) => r.payments[0]!.id);
const charge = (a: Actor) => m.fees.addCharge(a, W.students.day1, { fundId: W.funds.GENERAL, description: `Charge ${++counter}`, currency: 'USD', amount: '5.00' });
const request = (a: Actor, over: Record<string, unknown> = {}) =>
  m.requests.createRequest(a, { title: `Request ${++counter}`, type: 'PURCHASE_ORDER', department: 'Admin', justification: 'Needed', fundId: W.funds.GENERAL, currency: 'USD', items: [{ description: 'Thing', quantity: 1, unit: '10.00' }], submit: true, ...over });

// ─── Rule 1 ──────────────────────────────────────────────────────────────────

describe('rule 1: the person who recorded a payment does not verify it', () => {
  for (const [name, who] of people(['finance.payments.record', 'finance.payments.verify'])) {
    it(`${name} cannot verify a payment they recorded, and someone else can`, async () => {
      const a = await who();
      const id = await pay(a);
      await blocked(m.payments.verifyPayment(a, id), /You recorded this payment, so someone else must verify it/);
      expect((await prisma.finPayment.findUniqueOrThrow({ where: { id } })).status).not.toBe('VERIFIED');
      await m.payments.verifyPayment(W.bursar2, id);
      expect((await prisma.finPayment.findUniqueOrThrow({ where: { id } })).status).toBe('VERIFIED');
    });
  }
});

// ─── Rule 2 ──────────────────────────────────────────────────────────────────

describe('rule 2: the person who recorded a payment, charge or expense does not void it', () => {
  for (const [name, who] of people(['finance.payments.record', 'finance.payments.void'])) {
    it(`${name} cannot void a payment they recorded`, async () => {
      const a = await who();
      const id = await pay(a);
      await blocked(m.payments.voidPayment(a, id, 'Recorded in error today'), /You recorded this payment, so someone else must void it/);
      expect(await prisma.finVoid.count({ where: { paymentId: id } })).toBe(0);
    });
  }
  for (const [name, who] of people(['finance.expenses.record', 'finance.expenses.void'])) {
    it(`${name} cannot void an expense they recorded`, async () => {
      const a = await who();
      const e = await m.expenses.recordDirectExpense(a, { fundId: W.funds.GENERAL, category: 'Misc', description: 'Small item', currency: 'USD', amount: '1.00', method: 'CASH' });
      await blocked(m.expenses.voidExpense(a, e.id, 'Recorded in error today'), /You recorded this expense, so someone else must void it/);
    });
  }
  for (const [name, who] of people(['finance.charges.create', 'finance.charges.void'])) {
    it(`${name} cannot void a charge they made`, async () => {
      const a = await who();
      const c = await charge(a);
      await blocked(m.fees.voidCharge(a, c.id, 'Made in error today'), /You made this charge, so someone else must void it/);
    });
  }
  it('a school that switched on single-person finance lets its one voider void their own record, and nobody else', async () => {
    await prisma.school.update({ where: { id: A.schoolId }, data: { singlePersonFinance: true } });
    try {
      // Two people can void: the rule holds as ever.
      const owner = await exceptionally(W.owner, ['finance.payments.record', 'finance.payments.void']);
      const id = await pay(owner);
      await blocked(m.payments.voidPayment(owner, id, 'Recorded in error today'), /someone else must void it/);
    } finally {
      await prisma.school.update({ where: { id: A.schoolId }, data: { singlePersonFinance: false } });
    }
  });
});

// ─── Rule 3 ──────────────────────────────────────────────────────────────────

describe('rule 3: the person who raised a purchase request does not approve or pay it, and the approver does not pay it', () => {
  for (const [name, who] of people(['finance.requests.create', 'finance.requests.approve', 'finance.requests.disburse'])) {
    it(`${name} cannot approve or reject their own request`, async () => {
      const a = await who();
      const r = await request(a);
      await blocked(m.requests.decideRequest(a, r.id, 'approve'), /You raised this request, so someone else must approve it/);
      await blocked(m.requests.decideRequest(a, r.id, 'reject', 'Rejecting my own request'), /You raised this request, so someone else must reject it/);
    });
    it(`${name} cannot pay out their own request`, async () => {
      const a = await who();
      const r = await request(a);
      await m.requests.decideRequest(W.head, r.id, 'approve');
      await blocked(m.requests.disburseRequest(a, r.id, { method: 'CASH' }), /You raised this request, so someone else must pay it/);
    });
    it(`${name} cannot pay out a request they approved`, async () => {
      const a = await who();
      const r = await request(W.teacher);
      await m.requests.decideRequest(a, r.id, 'approve');
      await blocked(m.requests.disburseRequest(a, r.id, { method: 'CASH' }), /You approved this request, so someone else must pay it/);
    });
  }
});

// ─── Rule 4 ──────────────────────────────────────────────────────────────────

describe('rule 4: the person who asked for a discount, award, payment plan, credit note or refund does not approve it', () => {
  for (const [name, who] of people(['finance.adjustments.create', 'finance.adjustments.approve'])) {
    it(`${name} cannot approve a credit note or a discount they asked for`, async () => {
      const a = await who();
      const c = await charge(W.bursar);
      const adj = await m.adjustments.requestAdjustment(a, { chargeId: c.id, kind: 'DISCOUNT', amount: '1.00', reason: 'A small kindness' });
      await blocked(m.adjustments.decideAdjustment(a, adj.id, 'approve'), /You asked for this adjustment, so someone else must decide on it/);
      const rule = await prisma.discountRule.create({ data: { schoolId: A.schoolId, studentId: W.students.day2, kind: 'HARDSHIP', percentBps: 1000, termFromId: A.termId, reason: 'Hardship', createdById: a.id } as never });
      await blocked(m.discounts.decideRule(a, rule.id, 'approve'), /You asked for this, so someone else must decide on it/);
    });
  }
  for (const [name, who] of people(['finance.refunds.request', 'finance.refunds.approve', 'finance.refunds.pay'])) {
    it(`${name} cannot approve a refund they asked for, nor pay one they asked for or approved`, async () => {
      const a = await who();
      const paymentId = await pay(W.clerk);
      await m.payments.verifyPayment(W.bursar2, paymentId); // only a verified payment can be refunded
      const asked = await prisma.finRefund.create({ data: { schoolId: A.schoolId, paymentId, amountCents: 100, reason: 'Left the school', requestedById: a.id } as never });
      await blocked(m.refunds.decideRefund(a, asked.id, 'approve'), /You asked for this refund, so someone else must decide on it/);
      await prisma.finRefund.update({ where: { id: asked.id }, data: { status: 'APPROVED', approvedById: W.head.id, approvedAt: new Date() } });
      await blocked(m.refunds.payRefund(a, asked.id, { method: 'CASH' }), /You asked for this refund, so someone else must pay it out/);
      const approvedByMe = await prisma.finRefund.create({ data: { schoolId: A.schoolId, paymentId, amountCents: 100, reason: 'Left the school', requestedById: W.bursar.id } as never });
      await prisma.finRefund.update({ where: { id: approvedByMe.id }, data: { status: 'APPROVED', approvedById: a.id, approvedAt: new Date() } });
      await blocked(m.refunds.payRefund(a, approvedByMe.id, { method: 'CASH' }), /You approved this refund, so someone else must pay it out/);
    });
  }
  for (const [name, who] of people(['finance.plans.manage', 'finance.plans.approve'])) {
    it(`${name} cannot approve a payment plan they made`, async () => {
      const a = await who();
      const guardian = await prisma.guardian.create({ data: { schoolId: A.schoolId, fullName: 'Mrs Plan', phone: `07710${String(++counter).padStart(5, '0')}` } as never });
      const plan = await prisma.paymentPlan.create({ data: { schoolId: A.schoolId, guardianId: guardian.id, currency: 'USD', totalCents: 2000, startDate: new Date(), createdById: a.id, status: 'PENDING_APPROVAL' } as never });
      await blocked(m.plans.decidePlan(a, plan.id, 'approve'), /You recorded this plan, so someone else must decide on it/);
    });
  }
  for (const [name, who] of people(['finance.sponsors.manage', 'finance.awards.approve'])) {
    it(`${name} cannot approve a sponsor award they asked for`, async () => {
      const a = await who();
      const sponsor = await prisma.sponsor.create({ data: { schoolId: A.schoolId, name: `Sponsor ${++counter}`, type: 'COMPANY' } as never });
      const award = await prisma.sponsorAward.create({ data: { schoolId: A.schoolId, sponsorId: sponsor.id, studentId: W.students.day2, termFromId: A.termId, currency: 'USD', percentBps: 10000, createdById: a.id } as never });
      await blocked(m.sponsors.decideAward(a, award.id, 'approve'), /You asked for this award, so someone else must decide on it/);
    });
  }
});

// ─── Rule 10 ─────────────────────────────────────────────────────────────────

describe('rule 10: the cash-up is counted by one person, confirmed by a second and signed off by a third', () => {
  const day = () => new Date(Date.UTC(2031, 0, 1 + ++counter));
  /** A cash-up counted by `userId`, moved through the states the database allows. */
  const cashUp = async (userId: string, status: 'SUBMITTED' | 'CONFIRMED', confirmedById?: string) => {
    const c = await prisma.cashUp.create({ data: { schoolId: A.schoolId, userId, date: day() } as never });
    await prisma.cashUp.update({ where: { id: c.id }, data: { status: 'SUBMITTED', submittedAt: new Date() } as never });
    if (status === 'CONFIRMED') await prisma.cashUp.update({ where: { id: c.id }, data: { status: 'CONFIRMED', confirmedById, confirmedAt: new Date() } as never });
    return c;
  };
  for (const [name, who] of people(['finance.cashup.submit', 'finance.cashup.confirm', 'finance.cashup.signoff'])) {
    it(`${name} cannot confirm the cash they counted`, async () => {
      const a = await who();
      const c = await cashUp(a.id, 'SUBMITTED');
      await blocked(m.cashup.confirmCashUp(a, c.id), /You counted this cash, so someone else must confirm it/);
    });
    it(`${name} cannot sign off a day they counted or confirmed`, async () => {
      const a = await who();
      const counted = await cashUp(a.id, 'CONFIRMED', W.bursar.id);
      await blocked(m.cashup.signOffCashUp(a, counted.id), /You counted or confirmed this cash, so someone else must sign the day off/);
      const confirmed = await cashUp(W.clerk.id, 'CONFIRMED', a.id);
      await blocked(m.cashup.signOffCashUp(a, confirmed.id), /You counted or confirmed this cash, so someone else must sign the day off/);
    });
  }
});

// ─── Rule 5 (paying) ─────────────────────────────────────────────────────────

describe('rule 5: the person who prepared a payroll run does not pay it', () => {
  for (const [name, who] of people(['finance.payroll.pay'])) {
    it(`${name} cannot pay a payroll they prepared`, async () => {
      const a = await who();
      const run = await prisma.payrollRun.create({ data: { schoolId: A.schoolId, period: `2031-${String(++counter).padStart(2, '0')}`, preparedById: a.id, approvedById: W.head.id, status: 'READY' } as never });
      await blocked(m.finPayroll.markPayrollPaid(a, run.id, { lineIds: ['any-line'] }), /You prepared this payroll, so someone else must pay it/);
    });
  }
});

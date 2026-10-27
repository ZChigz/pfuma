import { describe, expect, it } from 'vitest';
import {
  assertCanApproveAdjustment,
  assertCanDisburseExpenseRequest,
  assertCanReviewExpenseRequest,
  assertCanVerifyPayment,
  assertCanVoid,
} from '@/lib/permissions';
import { AccessError } from '@/lib/access/errors';

// Runs fn and returns the 403 it throws.
function thrown(fn: () => unknown): { status: number; message: string; rule?: number } {
  try {
    fn();
  } catch (e) {
    if (e instanceof AccessError) return { status: e.status, message: e.message, rule: e.rule };
    throw e;
  }
  throw new Error('expected a 403 to be thrown');
}

const me = { id: 'u-me' };
const other = 'u-other';

describe('verify a payment (rule 1)', () => {
  it('blocks the person who recorded it, with a clear message', () => {
    const r = thrown(() => assertCanVerifyPayment(me, { recordedBy: me.id }));
    expect(r).toMatchObject({ status: 403, rule: 1, message: 'You recorded this payment, so another finance user must verify it.' });
  });
  it('allows anyone else', () => {
    expect(() => assertCanVerifyPayment(me, { recordedBy: other })).not.toThrow();
  });
});

describe('approve or reject an expense request (rule 3)', () => {
  it.each(['approve', 'reject'] as const)('blocks the requester from trying to %s', (verb) => {
    const r = thrown(() => assertCanReviewExpenseRequest(me, { requestedById: me.id }, verb));
    expect(r.status).toBe(403);
    expect(r.message).toMatch(new RegExp(`^You raised this request, so someone else must ${verb} it\\.`));
  });
  it('allows someone else', () => {
    expect(() => assertCanReviewExpenseRequest(me, { requestedById: other }, 'approve')).not.toThrow();
  });
});

describe('disburse an expense request (rule 3)', () => {
  it('blocks the requester', () => {
    expect(thrown(() => assertCanDisburseExpenseRequest(me, { requestedById: me.id, approvedById: other })).message).toMatch(/^You raised this request, so someone else must disburse it\./);
  });
  it('blocks the approver', () => {
    const r = thrown(() => assertCanDisburseExpenseRequest(me, { requestedById: other, approvedById: me.id }));
    expect(r.status).toBe(403);
    expect(r.message).toMatch(/^You approved this request, so someone else must disburse it\./);
  });
  it('allows a third person', () => {
    expect(() => assertCanDisburseExpenseRequest(me, { requestedById: 'a', approvedById: 'b' })).not.toThrow();
  });
});

describe('approve a charge adjustment or refund (rule 4)', () => {
  it('blocks the person who created it', () => {
    const r = thrown(() => assertCanApproveAdjustment(me, { createdById: me.id }));
    expect(r.status).toBe(403);
    expect(r.message).toMatch(/You created this credit note/);
  });
  it('allows someone else', () => {
    expect(() => assertCanApproveAdjustment(me, { createdById: other })).not.toThrow();
  });
});

describe('void a payment or expense (rule 2)', () => {
  const many = { singlePersonFinance: false, voiders: 2 };
  it('allows a different person without a reason', () => {
    expect(assertCanVoid(me, { recordedBy: other }, 'payment', many)).toBe(false);
  });
  it('blocks the recorder, even with a reason, whoever they are', () => {
    const r = thrown(() => assertCanVoid(me, { recordedBy: me.id }, 'payment', { ...many, reason: 'Entered twice by mistake' }));
    expect(r).toMatchObject({ status: 403, rule: 2 });
    expect(r.message).toMatch(/^You recorded this payment, so someone else must void it\./);
  });
  it('blocks the only person who can void too, unless the school switched on single-person finance', () => {
    const r = thrown(() => assertCanVoid(me, { recordedBy: me.id }, 'expense', { singlePersonFinance: false, voiders: 1, reason: 'Duplicate of expense 41' }));
    expect(r.message).toMatch(/You recorded this expense, so someone else must void it/);
  });
  it('lets the only voider of a single-person-finance school void their own record, but only with a reason', () => {
    const solo = { singlePersonFinance: true, voiders: 1 };
    const r = thrown(() => assertCanVoid(me, { recordedBy: me.id }, 'expense', solo));
    expect(r.status).toBe(403);
    expect(r.message).toMatch(/only person who can void/);
    expect(r.message).toMatch(/reason/);
    thrown(() => assertCanVoid(me, { recordedBy: me.id }, 'expense', { ...solo, reason: 'short' }));
    expect(assertCanVoid(me, { recordedBy: me.id }, 'expense', { ...solo, reason: 'Duplicate of expense 41' })).toBe(true);
  });
  it('does not let a single-person-finance school with two voiders skip the rule', () => {
    expect(thrown(() => assertCanVoid(me, { recordedBy: me.id }, 'payment', { singlePersonFinance: true, voiders: 2, reason: 'A good reason here' })).rule).toBe(2);
  });
});

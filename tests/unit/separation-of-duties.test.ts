import { describe, expect, it } from 'vitest';
import {
  assertCanApproveAdjustment,
  assertCanDisburseExpenseRequest,
  assertCanReviewExpenseRequest,
  assertCanVerifyPayment,
  assertCanVoid,
} from '@/lib/permissions';

// Runs fn and returns the Response it throws (the 403 the API sends back).
async function thrown(fn: () => unknown): Promise<{ status: number; message: string }> {
  try {
    fn();
  } catch (e) {
    if (e instanceof Response) return { status: e.status, message: (await e.json()).message };
    throw e;
  }
  throw new Error('expected a 403 Response to be thrown');
}

const me = { id: 'u-me' };
const other = 'u-other';

describe('verify a payment', () => {
  it('blocks the person who recorded it, with a clear message', async () => {
    const r = await thrown(() => assertCanVerifyPayment(me, { recordedBy: me.id }));
    expect(r.status).toBe(403);
    expect(r.message).toBe('You recorded this payment, so someone else must verify it.');
  });
  it('allows anyone else', () => {
    expect(() => assertCanVerifyPayment(me, { recordedBy: other })).not.toThrow();
  });
});

describe('approve or reject an expense request', () => {
  it.each(['approve', 'reject'] as const)('blocks the requester from trying to %s', async (verb) => {
    const r = await thrown(() => assertCanReviewExpenseRequest(me, { requestedById: me.id }, verb));
    expect(r.status).toBe(403);
    expect(r.message).toBe(`You raised this request, so someone else must ${verb} it.`);
  });
  it('allows someone else', () => {
    expect(() => assertCanReviewExpenseRequest(me, { requestedById: other }, 'approve')).not.toThrow();
  });
});

describe('disburse an expense request', () => {
  it('blocks the requester', async () => {
    const r = await thrown(() => assertCanDisburseExpenseRequest(me, { requestedById: me.id, approvedById: other }));
    expect(r.message).toBe('You raised this request, so someone else must disburse it.');
  });
  it('blocks the approver', async () => {
    const r = await thrown(() => assertCanDisburseExpenseRequest(me, { requestedById: other, approvedById: me.id }));
    expect(r.status).toBe(403);
    expect(r.message).toBe('You approved this request, so someone else must disburse it.');
  });
  it('allows a third person', () => {
    expect(() => assertCanDisburseExpenseRequest(me, { requestedById: 'a', approvedById: 'b' })).not.toThrow();
  });
});

describe('approve a charge adjustment or refund', () => {
  it('blocks the person who created it', async () => {
    const r = await thrown(() => assertCanApproveAdjustment(me, { createdById: me.id }));
    expect(r.status).toBe(403);
    expect(r.message).toMatch(/created this adjustment/);
  });
  it('allows someone else', () => {
    expect(() => assertCanApproveAdjustment(me, { createdById: other })).not.toThrow();
  });
});

describe('void a payment or expense', () => {
  it('allows a different person without a reason', () => {
    expect(assertCanVoid(me, { recordedBy: other }, 'payment', { activeDirectors: 2 })).toBe(false);
  });
  it('blocks the recorder when the school has several directors, even with a reason', async () => {
    const r = await thrown(() => assertCanVoid(me, { recordedBy: me.id }, 'payment', { activeDirectors: 2, reason: 'Entered twice by mistake' }));
    expect(r.status).toBe(403);
    expect(r.message).toBe('You recorded this payment, so another director must void it.');
  });
  it('lets a sole director void their own record, but only with a reason', async () => {
    const r = await thrown(() => assertCanVoid(me, { recordedBy: me.id }, 'expense', { activeDirectors: 1 }));
    expect(r.status).toBe(403);
    expect(r.message).toMatch(/only director/);
    expect(r.message).toMatch(/reason/);
    await thrown(() => assertCanVoid(me, { recordedBy: me.id }, 'expense', { activeDirectors: 1, reason: 'short' }));
    expect(assertCanVoid(me, { recordedBy: me.id }, 'expense', { activeDirectors: 1, reason: 'Duplicate of expense 41' })).toBe(true);
  });
});

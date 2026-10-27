// Separation of duties for the older routes (the screens written before roles were data).
//
// Who may do a thing is decided by permission keys, through lib/access.ts: `authorize(user, 'finance.payments.verify')`.
// These functions say that the same person may not do both halves of a money-handling step, and they call the one set of rules in
// lib/access/guards.ts, so the Owner and the Administrator are held to them like everyone else. Call them in the route after loading
// the record and before changing it. Each throws an AccessError (403) whose message names the rule and who can act instead.
import * as guards from '@/lib/access/guards';

interface Actor { id: string }

/** Rule 1: a payment cannot be verified by the person who recorded it. */
export function assertCanVerifyPayment(actor: Actor, payment: { recordedBy: string }): void {
  guards.recorderCannotVerify(actor, { recordedById: payment.recordedBy });
}

/** Rule 3: an expense request cannot be approved or rejected by the person who raised it. */
export function assertCanReviewExpenseRequest(actor: Actor, request: { requestedById: string }, verb: 'approve' | 'reject'): void {
  guards.requesterCannotApprove(actor, request, verb);
}

/** Rule 3: the person who raised or approved an expense request cannot hand out the money. */
export function assertCanDisburseExpenseRequest(actor: Actor, request: { requestedById: string; approvedById: string | null }): void {
  guards.requesterAndApproverCannotDisburse(actor, request);
}

/** Rule 4: a charge adjustment or refund cannot be approved by the person who created it. */
export function assertCanApproveAdjustment(actor: Actor, adjustment: { createdById: string }): void {
  guards.creatorCannotApprove(actor, adjustment, 'credit note');
}

export const VOID_REASON_MIN_LENGTH = guards.SOLE_VOIDER_REASON_MIN_LENGTH;

/**
 * Rule 2: a payment or expense cannot be voided by the person who recorded it, whoever they are. The one accommodation is a school that
 * has switched on "single-person finance" and has only one person who can void: nobody else could ever void the record, so that person
 * may, but must give a reason (which the caller writes to the audit log). Returns true when that accommodation was used.
 */
export function assertCanVoid(
  actor: Actor,
  record: { recordedBy: string },
  kind: 'payment' | 'expense',
  opts: { singlePersonFinance: boolean; voiders: number; reason?: string | null },
): boolean {
  return guards.recorderCannotVoidUnlessSoleVoider(actor, { recordedById: record.recordedBy }, kind, opts);
}

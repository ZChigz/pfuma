// Separation of duties. These sit on top of permissions and apply to everyone, the Owner and the Administrator included: holding both
// keys is not enough if you are the same person on the same record. One named function per rule (docs: Separation-of-duties rules);
// each throws an AccessError (403) whose message names the rule and who can act instead. Call them in the service, after loading the
// record and before changing it.
import { AccessError } from './errors';

/** Anyone with an id. */
export interface Person { id: string }
/** A person with the role keys they hold (OWNER, HR_OFFICER ...) and the permission keys they were granted. */
export interface PersonWithRoles extends Person { roles?: readonly string[]; grants?: readonly string[] }

const refuse = (rule: number, message: string) => new AccessError(message, 403, 'SEPARATION_OF_DUTIES', undefined, rule);

// ── Money ────────────────────────────────────────────────────────────────────

/** Rule 1: whoever recorded a payment cannot verify it. */
export function recorderCannotVerify(actor: Person, payment: { recordedById: string }): void {
  if (actor.id === payment.recordedById) throw refuse(1, 'You recorded this payment, so another finance user must verify it.');
}

/** Rule 2: whoever recorded a payment, charge or expense cannot void it. */
export function recorderCannotVoid(actor: Person, record: { recordedById: string }, what: 'payment' | 'charge' | 'expense' = 'payment'): void {
  if (actor.id === record.recordedById) throw refuse(2, `You recorded this ${what}, so someone else must void it. The Owner can, if the Owner did not record it.`);
}

export const SOLE_VOIDER_REASON_MIN_LENGTH = 10;

/**
 * Rule 2 with the one accommodation a small school needs: when the school has switched on single-person finance and only one person can
 * void, that person may void what they recorded themselves, with a written reason (the caller audits it). Returns true when used.
 */
export function recorderCannotVoidUnlessSoleVoider(
  actor: Person,
  record: { recordedById: string },
  what: 'payment' | 'charge' | 'expense',
  opts: { singlePersonFinance: boolean; voiders: number; reason?: string | null },
): boolean {
  if (actor.id !== record.recordedById) return false;
  if (!opts.singlePersonFinance || opts.voiders > 1) recorderCannotVoid(actor, record, what);
  if (!opts.reason || opts.reason.trim().length < SOLE_VOIDER_REASON_MIN_LENGTH) {
    throw refuse(2, `You recorded this ${what} and you are the only person who can void it. Give a reason of at least ${SOLE_VOIDER_REASON_MIN_LENGTH} characters to void it.`);
  }
  return true;
}

/** Rule 3a: a requester cannot approve (or reject) their own purchase request. */
export function requesterCannotApprove(actor: Person, request: { requestedById: string }, verb: 'approve' | 'reject' = 'approve'): void {
  if (actor.id === request.requestedById) throw refuse(3, `You raised this request, so someone else must ${verb} it. Ask the Head or the Owner.`);
}

/** Rule 3b: the requester and the approver cannot pay out the request they asked for or approved. */
export function requesterAndApproverCannotDisburse(actor: Person, request: { requestedById: string; approvedById?: string | null }): void {
  if (actor.id === request.requestedById) throw refuse(3, 'You raised this request, so someone else must disburse it. Ask the Bursar.');
  if (request.approvedById && actor.id === request.approvedById) throw refuse(3, 'You approved this request, so someone else must disburse it. Ask the Bursar.');
}

/** Rule 4: whoever creates a discount, award, payment plan or refund cannot approve it. */
export function creatorCannotApprove(actor: Person, record: { createdById: string }, what: 'discount' | 'award' | 'payment plan' | 'refund' | 'credit note'): void {
  if (actor.id === record.createdById) throw refuse(4, `You created this ${what}, so someone else must approve it. Ask the Head or the Owner.`);
}

/** Rule 5: whoever prepares a payroll run cannot approve it or mark it paid. */
export function preparerCannotApproveOrPay(actor: Person, run: { preparedById: string }, step: 'approve' | 'mark it paid'): void {
  if (actor.id === run.preparedById) throw refuse(5, `You prepared this payroll run, so someone else must ${step}. Ask the Owner${step === 'approve' ? '' : ' or the Bursar'}.`);
}

// ── Results ──────────────────────────────────────────────────────────────────

/**
 * Rule 6: a teacher (or co-teacher) on an assignment cannot verify that mark sheet, even as head of the department. It goes to the
 * department's alternate verifier: another head of department, or the Deputy Head.
 */
export function teacherCannotVerifyOwnSheet(actor: Person, assignment: { teacherId: string; coTeacherId?: string | null }): void {
  if (actor.id === assignment.teacherId || (assignment.coTeacherId && actor.id === assignment.coTeacherId)) {
    throw refuse(6, 'You teach this class, so you cannot verify its mark sheet. It goes to another head of department, or to the Deputy Head.');
  }
}

// ── People ───────────────────────────────────────────────────────────────────

/** Rule 7: nobody approves their own leave, exeat request, duty swap or expense claim. */
export function cannotApproveOwn(actor: Person, ownerId: string, what: 'leave' | 'exeat request' | 'duty swap' | 'expense claim' | 'disposal request' | 'vehicle booking'): void {
  if (actor.id === ownerId) throw refuse(7, `This is your own ${what}, so someone else must approve it.`);
}

/** Rule 8: nobody edits their own roles, grants or exceptions. */
export function cannotChangeOwnAccess(actor: Person, targetUserId: string): void {
  if (actor.id === targetUserId) throw refuse(8, 'You cannot change your own roles or permissions. Ask another administrator, or the Owner.');
}

/**
 * Rule 9: a change to a staff member's bank details needs two people, HR and the Owner: one asks, the other approves. The same person
 * cannot do both, and the pair must be one Owner and one person who looks after staff pay.
 */
export function bankChangeNeedsHrAndOwner(asker: PersonWithRoles, approver: PersonWithRoles): void {
  if (asker.id === approver.id) throw refuse(9, 'A change to bank details needs two people: HR asks and the Owner approves. You cannot do both.');
  const owner = (p: PersonWithRoles) => !!p.roles?.includes('OWNER');
  const hr = (p: PersonWithRoles) => !!p.roles?.includes('HR_OFFICER') || !!p.grants?.includes('hr.pay.manage');
  const ok = (owner(asker) && hr(approver)) || (hr(asker) && owner(approver));
  if (!ok) throw refuse(9, 'A change to bank details needs HR and the Owner. Ask the Owner to approve a change asked for by HR.');
}

// ── Cash-up ──────────────────────────────────────────────────────────────────

/** Rule 10, step 2: the cash-up is counted by the clerk and confirmed by someone else (the Bursar). */
export function clerkCannotConfirmOwnCashUp(actor: Person, cashUp: { userId: string }): void {
  if (actor.id === cashUp.userId) throw refuse(10, 'You counted this cash-up, so the Bursar must confirm it.');
}

/** Rule 10, step 3: the Head signs off a cash-up that neither counted nor confirmed. Three different people in all. */
export function signOffNeedsThirdPerson(actor: Person, cashUp: { userId: string; confirmedById?: string | null }): void {
  if (actor.id === cashUp.userId) throw refuse(10, 'You counted this cash-up, so the Head must sign it off.');
  if (cashUp.confirmedById && actor.id === cashUp.confirmedById) throw refuse(10, 'You confirmed this cash-up, so the Head must sign it off.');
}

/**
 * A new post is approved by the Head and by the Owner, two different people. Which of the two seats a person can fill follows the role
 * they hold (the rule is about those two offices); a person who holds both fills whichever is still open.
 */
export function postApprovalSeats(approver: PersonWithRoles): ('head' | 'owner')[] {
  const seats: ('head' | 'owner')[] = [];
  if (approver.roles?.includes('HEAD')) seats.push('head');
  if (approver.roles?.includes('OWNER')) seats.push('owner');
  return seats;
}

// ── Who may change who can do what ─────────────────────────────────────────────

/** Only the Owner can give or take away these roles (docs: Managing roles safely, Protected roles). */
export const PROTECTED_ROLES = ['OWNER', 'HEAD', 'BURSAR', 'ADMINISTRATOR'] as const;

const roleName = (key: string) => key.toLowerCase().split('_').map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');

/** The Owner holds the OWNER role; nobody else may give or take away a protected role. `changed` is the roles added and removed. */
export function protectedRolesNeedOwner(actor: PersonWithRoles, changed: readonly string[]): void {
  const hit = changed.filter((k) => (PROTECTED_ROLES as readonly string[]).includes(k));
  if (hit.length && !actor.roles?.includes('OWNER')) {
    throw new AccessError(`Only the Owner can give or take away the ${hit.map(roleName).join(' and ')} role. Ask the Owner.`, 403, 'PROTECTED_ROLE');
  }
}

/** The Owner of the school (the role, not a permission: the rules about two approvals name the office). */
export const isOwner = (person: PersonWithRoles): boolean => !!person.roles?.includes('OWNER');

/** Money and staff-pay permissions (finance, pay, payroll) and the power to edit roles are given and taken away by the Owner. */
export const isOwnerOnlyKey = (key: string): boolean => /^(finance\.|hr\.pay\.|hr\.payroll\.)/.test(key) || key === 'system.roles.edit';

export function ownerOnlyKeyNeedsOwner(actor: PersonWithRoles, key: string): void {
  if (isOwnerOnlyKey(key) && !actor.roles?.includes('OWNER')) {
    throw new AccessError('Finance and staff-pay permissions are given by the Owner only. Ask the Owner.', 403, 'PROTECTED_ROLE', key);
  }
}

/** Every rule by number, for tests and for the page that explains them. */
export const RULES: { n: number; text: string }[] = [
  { n: 1, text: 'Whoever records a payment cannot verify it' },
  { n: 2, text: 'Whoever recorded a payment, charge or expense cannot void it' },
  { n: 3, text: 'A requester cannot approve or disburse their own purchase request; the approver cannot disburse it' },
  { n: 4, text: 'Whoever creates a discount, award, payment plan or refund cannot approve it' },
  { n: 5, text: 'Whoever prepares a payroll run cannot approve it or mark it paid' },
  { n: 6, text: 'A teacher cannot verify their own mark sheet, even as head of department' },
  { n: 7, text: 'Nobody approves their own leave, exeat request, duty swap or expense claim' },
  { n: 8, text: 'Nobody edits their own roles, grants or exceptions' },
  { n: 9, text: 'Bank detail changes for staff need two people: HR and the Owner' },
  { n: 10, text: 'Cash-ups are counted by the clerk, confirmed by the Bursar, signed off by the Head' },
];

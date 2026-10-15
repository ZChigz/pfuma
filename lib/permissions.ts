import type { UserRole } from '@/types';

// Allowed-role lists — single source of truth used by both the guard
// functions and any UI that needs to know which roles can do what.
export const Permission = {
  manageUsers:        ['ADMIN', 'DIRECTOR']                            as UserRole[],
  manageClasses:      ['ADMIN', 'DIRECTOR', 'HEAD']                    as UserRole[],
  manageStudents:     ['ADMIN', 'DIRECTOR', 'HEAD']                    as UserRole[],
  applyCharge:        ['ADMIN', 'DIRECTOR', 'HEAD']                    as UserRole[],
  bulkApplyFees:      ['ADMIN', 'DIRECTOR', 'HEAD']                    as UserRole[],
  // The bursar records payments; someone else verifies them.
  verifyPayment:      ['HEAD', 'DIRECTOR']                             as UserRole[],
  voidPayment:        ['DIRECTOR']                                     as UserRole[],
  recordPayment:      ['BURSAR', 'HEAD', 'DIRECTOR', 'ADMIN']          as UserRole[],
  recordExpense:      ['BURSAR', 'HEAD', 'DIRECTOR']                   as UserRole[],
  voidExpense:        ['DIRECTOR']                                     as UserRole[],
  enterMarks:         ['TEACHER', 'HEAD', 'DIRECTOR']                  as UserRole[],
  verifyMarks:        ['TEACHER', 'HEAD', 'DIRECTOR']                  as UserRole[],
  unverifyMarks:      ['HEAD', 'DIRECTOR']                             as UserRole[],
  manageSubjects:     ['ADMIN', 'HEAD', 'DIRECTOR']                    as UserRole[],
  publishResults:     ['HEAD', 'DIRECTOR']                             as UserRole[],
  exportResults:      ['HEAD', 'DIRECTOR', 'ADMIN']                    as UserRole[],
  manageLibrary:      ['LIBRARIAN', 'HEAD', 'DIRECTOR', 'ADMIN']       as UserRole[],
  manageGradeBoundaries: ['HEAD', 'DIRECTOR', 'ADMIN']                 as UserRole[],
  manageAssets:       ['DIRECTOR', 'HEAD', 'BURSAR']                   as UserRole[],
  disposeAsset:       ['DIRECTOR', 'HEAD']                             as UserRole[],
  createExpenseRequest: ['TEACHER', 'BURSAR', 'HEAD', 'DIRECTOR', 'ADMIN'] as UserRole[],
  approveRequest:     ['HEAD', 'DIRECTOR']                             as UserRole[],
  disburseRequest:    ['BURSAR', 'HEAD', 'DIRECTOR']                   as UserRole[],
  manageAcademicCalendar: ['ADMIN', 'HEAD', 'DIRECTOR']                as UserRole[],
  manageEnrollment:   ['ADMIN', 'HEAD', 'DIRECTOR']                    as UserRole[],
  manageGuardians:    ['ADMIN', 'HEAD', 'DIRECTOR']                    as UserRole[],
  // Parent-portal links and PINs.
  managePortalLinks:  ['ADMIN', 'HEAD', 'BURSAR']                      as UserRole[],
  // Unpublish a class's results for a correction: Head only.
  unpublishResults:   ['HEAD']                                         as UserRole[],
  // Mark an absence as excused (leaves it out of the student's subjects): Head only.
  excuseAbsence:      ['HEAD']                                         as UserRole[],
  // Reopen a CLOSED term: Director only.
  reopenTerm:         ['DIRECTOR']                                     as UserRole[],
} satisfies Record<string, UserRole[]>;

const forbidden = () =>
  new Response(JSON.stringify({ success: false, message: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });

async function guard(role: UserRole, allowed: UserRole[]): Promise<void> {
  if (!allowed.includes(role)) throw forbidden();
}

function guardSync(role: UserRole, allowed: UserRole[]): void {
  if (!allowed.includes(role)) throw forbidden();
}

export async function canManageUsers(role: UserRole): Promise<void>     { await guard(role, Permission.manageUsers);     }
export async function canManageClasses(role: UserRole): Promise<void>   { await guard(role, Permission.manageClasses);   }
export async function canManageStudents(role: UserRole): Promise<void>  { await guard(role, Permission.manageStudents);  }
export async function canApplyCharge(role: UserRole): Promise<void>     { await guard(role, Permission.applyCharge);     }
export async function canBulkApplyFees(role: UserRole): Promise<void>   { await guard(role, Permission.bulkApplyFees);   }
export async function canVerifyPayment(role: UserRole): Promise<void>   { await guard(role, Permission.verifyPayment);   }
export async function canVoidPayment(role: UserRole): Promise<void>     { await guard(role, Permission.voidPayment);     }
export async function canRecordPayment(role: UserRole): Promise<void>   { await guard(role, Permission.recordPayment);   }
export async function canRecordExpense(role: UserRole): Promise<void>   { await guard(role, Permission.recordExpense);   }
export async function canVoidExpense(role: UserRole): Promise<void>     { await guard(role, Permission.voidExpense);     }
export async function canEnterMarks(role: UserRole): Promise<void>      { await guard(role, Permission.enterMarks);      }
export async function canVerifyMarks(role: UserRole): Promise<void>     { await guard(role, Permission.verifyMarks);     }
export async function canUnverifyMarks(role: UserRole): Promise<void>   { await guard(role, Permission.unverifyMarks);   }
export async function canManageSubjects(role: UserRole): Promise<void>  { await guard(role, Permission.manageSubjects);  }
export async function canPublishResults(role: UserRole): Promise<void>  { await guard(role, Permission.publishResults);  }
export async function canExportResults(role: UserRole): Promise<void>   { await guard(role, Permission.exportResults);   }
export async function canManageLibrary(role: UserRole): Promise<void>   { await guard(role, Permission.manageLibrary);   }
export async function canManageAssets(role: UserRole): Promise<void>    { await guard(role, Permission.manageAssets);    }
export async function canDisposeAsset(role: UserRole): Promise<void>    { await guard(role, Permission.disposeAsset);    }
export async function canCreateExpenseRequest(role: UserRole): Promise<void> { await guard(role, Permission.createExpenseRequest); }
export async function canApproveRequest(role: UserRole): Promise<void>  { await guard(role, Permission.approveRequest);  }
export async function canDisburseRequest(role: UserRole): Promise<void> { await guard(role, Permission.disburseRequest); }
export async function canManageAcademicCalendar(role: UserRole): Promise<void> { await guard(role, Permission.manageAcademicCalendar); }
// Admit, transfer class, promote, repeat, transfer out, withdraw, graduate.
export async function canManageEnrollment(role: UserRole): Promise<void> { await guard(role, Permission.manageEnrollment); }
export async function canManageGuardians(role: UserRole): Promise<void> { await guard(role, Permission.manageGuardians); }

export async function canManagePortalLinks(role: UserRole): Promise<void> { await guard(role, Permission.managePortalLinks); }
export async function canExcuseAbsence(role: UserRole): Promise<void> { await guard(role, Permission.excuseAbsence); }
export async function canReopenTerm(role: UserRole): Promise<void> { await guard(role, Permission.reopenTerm); }
export async function canUnpublishResults(role: UserRole): Promise<void> { await guard(role, Permission.unpublishResults); }

export function canEnterMarksSync(role: UserRole): void {
  guardSync(role, Permission.enterMarks);
}

export function canManageGradeBoundaries(role: UserRole): void {
  guardSync(role, Permission.manageGradeBoundaries);
}

// ─── Separation of duties ────────────────────────────────────────────────────
// Role checks above say WHO may do something; these say that the same person
// may not do both halves of a money-handling step. Call them in the API route,
// after loading the record and before changing it. Each throws a 403 Response
// with a message that tells the user what to do, which withApi returns as-is.

const conflict = (message: string) =>
  new Response(JSON.stringify({ success: false, message }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });

interface Actor { id: string }

/** A payment cannot be verified by the person who recorded it. */
export function assertCanVerifyPayment(actor: Actor, payment: { recordedBy: string }): void {
  if (actor.id === payment.recordedBy) {
    throw conflict('You recorded this payment, so someone else must verify it.');
  }
}

/** An expense request cannot be approved or rejected by the person who raised it. */
export function assertCanReviewExpenseRequest(
  actor: Actor,
  request: { requestedById: string },
  verb: 'approve' | 'reject',
): void {
  if (actor.id === request.requestedById) {
    throw conflict(`You raised this request, so someone else must ${verb} it.`);
  }
}

/** The person who raised or approved an expense request cannot hand out the money. */
export function assertCanDisburseExpenseRequest(
  actor: Actor,
  request: { requestedById: string; approvedById: string | null },
): void {
  if (actor.id === request.requestedById) {
    throw conflict('You raised this request, so someone else must disburse it.');
  }
  if (request.approvedById && actor.id === request.approvedById) {
    throw conflict('You approved this request, so someone else must disburse it.');
  }
}

/**
 * A charge adjustment or refund cannot be approved by the person who created it.
 * (The system has no adjustment/refund workflow yet; call this from its approve route.)
 */
export function assertCanApproveAdjustment(actor: Actor, adjustment: { createdById: string }): void {
  if (actor.id === adjustment.createdById) {
    throw conflict('You created this adjustment, so someone else must approve it.');
  }
}

export const VOID_REASON_MIN_LENGTH = 10;

/**
 * A payment or expense cannot be voided by the person who recorded it. The one
 * exception is a school with a single active director: nobody else could ever
 * void it, so the director may, but must give a reason (which the caller must
 * write to the audit log). Returns true when that exception was used.
 */
export function assertCanVoid(
  actor: Actor,
  record: { recordedBy: string },
  kind: 'payment' | 'expense',
  opts: { activeDirectors: number; reason?: string | null },
): boolean {
  if (actor.id !== record.recordedBy) return false;
  if (opts.activeDirectors > 1) {
    throw conflict(`You recorded this ${kind}, so another director must void it.`);
  }
  if (!opts.reason || opts.reason.trim().length < VOID_REASON_MIN_LENGTH) {
    throw conflict(
      `You recorded this ${kind} and you are the school's only director. Give a reason of at least ${VOID_REASON_MIN_LENGTH} characters to void it.`,
    );
  }
  return true;
}

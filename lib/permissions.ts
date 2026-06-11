import type { UserRole } from '@/types';

// Allowed-role lists — single source of truth used by both the guard
// functions and any UI that needs to know which roles can do what.
export const Permission = {
  manageUsers:        ['ADMIN', 'DIRECTOR']                            as UserRole[],
  manageClasses:      ['ADMIN', 'DIRECTOR', 'HEAD']                    as UserRole[],
  manageStudents:     ['ADMIN', 'DIRECTOR', 'HEAD']                    as UserRole[],
  applyCharge:        ['ADMIN', 'DIRECTOR', 'HEAD']                    as UserRole[],
  bulkApplyFees:      ['ADMIN', 'DIRECTOR', 'HEAD']                    as UserRole[],
  verifyPayment:      ['BURSAR', 'HEAD', 'DIRECTOR']                   as UserRole[],
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

export function canEnterMarksSync(role: UserRole): void {
  guardSync(role, Permission.enterMarks);
}

export function canManageGradeBoundaries(role: UserRole): void {
  guardSync(role, Permission.manageGradeBoundaries);
}

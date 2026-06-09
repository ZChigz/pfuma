import type { UserRole } from '@/types';

// Allowed-role lists — single source of truth used by both the guard
// functions and any UI that needs to know which roles can do what.
export const Permission = {
  verifyPayment:  ['DIRECTOR', 'HEAD', 'BURSAR']           as UserRole[],
  voidPayment:    ['DIRECTOR']                             as UserRole[],
  applyCharge:    ['DIRECTOR', 'HEAD']                     as UserRole[],
  publishResults: ['DIRECTOR', 'HEAD']                     as UserRole[],
  manageAssets:   ['DIRECTOR', 'HEAD', 'BURSAR']           as UserRole[],
  disposeAsset:   ['DIRECTOR', 'HEAD']                     as UserRole[],
  manageLibrary:  ['DIRECTOR', 'HEAD', 'LIBRARIAN']        as UserRole[],
  manageStudents: ['DIRECTOR', 'HEAD', 'BURSAR']           as UserRole[],
  voidExpense:    ['DIRECTOR']                             as UserRole[],
  manageSubjects: ['DIRECTOR', 'HEAD']                     as UserRole[],
  enterMarks:     ['DIRECTOR', 'HEAD', 'TEACHER']          as UserRole[],
} satisfies Record<string, UserRole[]>;

const forbidden = () =>
  new Response(JSON.stringify({ success: false, message: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });

async function guard(role: UserRole, allowed: UserRole[]): Promise<void> {
  if (!allowed.includes(role)) throw forbidden();
}

export async function canVerifyPayment(role: UserRole): Promise<void>  { await guard(role, Permission.verifyPayment);  }
export async function canVoidPayment(role: UserRole): Promise<void>    { await guard(role, Permission.voidPayment);    }
export async function canApplyCharge(role: UserRole): Promise<void>    { await guard(role, Permission.applyCharge);    }
export async function canPublishResults(role: UserRole): Promise<void> { await guard(role, Permission.publishResults); }
export async function canManageAssets(role: UserRole): Promise<void>   { await guard(role, Permission.manageAssets);   }
export async function canDisposeAsset(role: UserRole): Promise<void>   { await guard(role, Permission.disposeAsset);   }
export async function canManageLibrary(role: UserRole): Promise<void>  { await guard(role, Permission.manageLibrary);  }
export async function canManageStudents(role: UserRole): Promise<void> { await guard(role, Permission.manageStudents); }
export async function canVoidExpense(role: UserRole): Promise<void>    { await guard(role, Permission.voidExpense);    }
export async function canManageSubjects(role: UserRole): Promise<void> { await guard(role, Permission.manageSubjects); }
export async function canEnterMarks(role: UserRole): Promise<void>     { await guard(role, Permission.enterMarks);     }

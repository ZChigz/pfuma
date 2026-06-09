export type Role = 'DIRECTOR' | 'HEAD' | 'BURSAR' | 'TEACHER' | 'LIBRARIAN';

export type UserRole = Role;

export interface SessionUser {
  id: string;
  email: string;
  schoolId: string;
  role: UserRole;
  fullName: string;
}

export type Currency = 'USD' | 'ZIG';

export type PaymentMethod = 'CASH' | 'ECOCASH' | 'SWIPE' | 'ZIPIT';

export type PaymentStatus = 'PENDING' | 'VERIFIED' | 'VOIDED';

export type ExpenseStatus = 'ACTIVE' | 'VOIDED';

export type SubjectType = 'CORE' | 'ELECTIVE';

export type AssetCondition = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'CONDEMNED';

export type AssetStatus = 'ACTIVE' | 'UNDER_MAINTENANCE' | 'DISPOSED';

export type DisposalMethod = 'SOLD' | 'SCRAPPED' | 'DONATED';

export type CopyCondition = 'NEW' | 'GOOD' | 'FAIR' | 'DAMAGED';

export type CopyStatus = 'AVAILABLE' | 'BORROWED' | 'LOST';

export type AuditAction =
  | 'RECORD_PAYMENT'
  | 'VERIFY_PAYMENT'
  | 'VOID_PAYMENT'
  | 'RECORD_EXPENSE'
  | 'VOID_EXPENSE'
  | 'APPLY_CHARGE'
  | 'CREATE_STUDENT'
  | 'UPDATE_STUDENT'
  | 'PUBLISH_RESULTS'
  | 'CREATE_ASSET'
  | 'UPDATE_ASSET'
  | 'DISPOSE_ASSET'
  | 'CHECKOUT_BOOK'
  | 'RETURN_BOOK';

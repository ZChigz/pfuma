export type Role = 'ADMIN' | 'DIRECTOR' | 'HEAD' | 'BURSAR' | 'TEACHER' | 'LIBRARIAN';

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

export type RequestStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISBURSED';

export type ExpenseRequestType =
  | 'PURCHASE_ORDER'
  | 'UTILITY_BILL'
  | 'FUEL'
  | 'SALARY_ADVANCE'
  | 'MAINTENANCE'
  | 'OTHER';

export type SubjectType = 'CORE' | 'ELECTIVE';

export type MarkStatus = 'DRAFT' | 'VERIFIED' | 'PUBLISHED';

export type AssignmentMarkStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'VERIFIED' | 'PUBLISHED';

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
  | 'RECORD_MARK'
  | 'VERIFY_MARKS'
  | 'UNVERIFY_MARKS'
  | 'PUBLISH_RESULTS'
  | 'CREATE_ASSET'
  | 'UPDATE_ASSET'
  | 'DISPOSE_ASSET'
  | 'CHECKOUT_BOOK'
  | 'RETURN_BOOK'
  | 'CREATE_USER'
  | 'UPDATE_USER'
  | 'RESET_PASSWORD'
  | 'CREATE_CLASS'
  | 'UPDATE_CLASS'
  | 'MOVE_STUDENT'
  | 'BULK_APPLY_FEES'
  | 'CREATE_FEE_STRUCTURE'
  | 'UPDATE_FEE_STRUCTURE'
  | 'CREATE_EXPENSE_REQUEST'
  | 'SUBMIT_EXPENSE_REQUEST'
  | 'APPROVE_EXPENSE_REQUEST'
  | 'REJECT_EXPENSE_REQUEST'
  | 'DISBURSE_EXPENSE_REQUEST';

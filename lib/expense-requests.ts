import type { ExpenseRequest, ExpenseRequestItem, ExpenseRequestType } from '@prisma/client';
import type { BadgeVariant } from '@/components/ui/Badge';
import type { RequestStatus } from '@/types';

export const REQUEST_INCLUDE = {
  requestedBy: { select: { fullName: true } },
  approvedBy:  { select: { fullName: true } },
  rejectedBy:  { select: { fullName: true } },
  disbursedBy: { select: { fullName: true } },
  items:       true,
} as const;

// Maps an expense request type to the category recorded on the Expense
// ledger entry created automatically on disbursement.
export const EXPENSE_CATEGORY_BY_TYPE: Record<ExpenseRequestType, string> = {
  PURCHASE_ORDER: 'Purchase Order',
  UTILITY_BILL:   'Utilities',
  FUEL:           'Fuel',
  SALARY_ADVANCE: 'Staff Salaries',
  MAINTENANCE:    'Maintenance',
  OTHER:          'Other',
};

export const REQUEST_TYPE_LABELS: Record<ExpenseRequestType, string> = {
  PURCHASE_ORDER: 'Purchase Order',
  UTILITY_BILL:   'Utility Bill',
  FUEL:           'Fuel',
  SALARY_ADVANCE: 'Salary Advance',
  MAINTENANCE:    'Maintenance',
  OTHER:          'Other',
};

export const REQUEST_STATUS_BADGE: Record<RequestStatus, { label: string; variant: BadgeVariant }> = {
  DRAFT:     { label: 'Draft',              variant: 'neutral' },
  PENDING:   { label: 'Awaiting approval',  variant: 'warning' },
  APPROVED:  { label: 'Approved',           variant: 'info'    },
  REJECTED:  { label: 'Rejected',           variant: 'danger'  },
  DISBURSED: { label: 'Disbursed',          variant: 'success' },
};

type RequestWithRelations = ExpenseRequest & { items?: ExpenseRequestItem[] };

export function serializeExpenseRequest<T extends RequestWithRelations>(request: T) {
  return {
    ...request,
    estimatedTotal: request.estimatedTotal.toNumber(),
    actualTotal:    request.actualTotal ? request.actualTotal.toNumber() : null,
    items: request.items?.map((item) => ({
      ...item,
      unitPrice: item.unitPrice.toNumber(),
      total:     item.total.toNumber(),
    })),
  };
}

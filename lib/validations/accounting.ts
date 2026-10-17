import { z } from 'zod';

// Students are admitted through /api/admin/students (lib/students/registration.ts)
// and change status through lifecycle actions; only these details are editable here.
export const UpdateStudentSchema = z.object({
  firstName:      z.string().trim().min(2).max(50).optional(),
  surname:        z.string().trim().min(2).max(50).optional(),
  previousSchool: z.string().trim().max(100).nullable().optional(),
  // Medical details are changed only on the student's Medical tab (students.medical.edit).
});

export const CreateChargeSchema = z.object({
  studentId: z.string().min(1),
  label: z.string().min(1),
  currency: z.enum(['USD', 'ZIG']),
  amount: z.number().positive(),
  termId: z.string().min(1, 'Term is required'),
});

export const CreateFeeStructureSchema = z.object({
  levelId: z.string().min(1).nullable(), // null = every level
  termId: z.string().min(1, 'Term is required'),
  label: z.string().min(1),
  currency: z.enum(['USD', 'ZIG']),
  amount: z.number().positive(),
});

export const UpdateFeeStructureSchema = CreateFeeStructureSchema.partial();

export const ApplyFeeStructureSchema = z.object({
  feeStructureId: z.string().min(1),
  studentIds: z.array(z.string().min(1)).min(1),
});

export const CreatePaymentSchema = z
  .object({
    studentId: z.string().min(1),
    currency: z.enum(['USD', 'ZIG']),
    amount: z
      .number({ error: 'Please enter an amount' })
      .positive('Amount must be greater than zero'),
    method: z.enum(['CASH', 'ECOCASH', 'SWIPE', 'ZIPIT']),
    reference: z.string().optional(),
    feeLabel: z.string().min(1, 'Fee label is required'),
    // Private upload key from /api/upload (proofOfPayment); checked against the school in the route.
    popKey: z.string().max(200).optional(),
    paidInZig:        z.boolean(),
    zigAmountPaid:    z.number().positive().optional(),
    exchangeRateUsed: z.number().positive().optional(),
  })
  .refine(
    (d) => d.method === 'CASH' || (d.reference != null && d.reference.trim().length > 0),
    { message: 'Reference is required for non-cash payments', path: ['reference'] },
  )
  .refine(
    (d) => !d.paidInZig || d.currency === 'USD',
    { message: 'ZiG conversion payments must be recorded in USD', path: ['currency'] },
  )
  .refine(
    (d) => !d.paidInZig || (d.zigAmountPaid != null && d.zigAmountPaid > 0),
    { message: 'ZiG amount received is required', path: ['zigAmountPaid'] },
  )
  .refine(
    (d) => !d.paidInZig || (d.exchangeRateUsed != null && d.exchangeRateUsed > 0),
    { message: 'Exchange rate is required', path: ['exchangeRateUsed'] },
  )
  .refine(
    (d) => {
      if (!d.paidInZig || !d.zigAmountPaid || !d.exchangeRateUsed) return true;
      return Math.abs(d.amount - d.zigAmountPaid / d.exchangeRateUsed) <= 0.02;
    },
    { message: 'Amount does not match ZiG conversion', path: ['amount'] },
  );

export const CreateExpenseSchema = z.object({
  category: z.string().min(1, 'Category is required'),
  currency: z.enum(['USD', 'ZIG']),
  amount: z
    .number({ error: 'Please enter an amount' })
    .positive('Amount must be greater than zero'),
  spentOn: z.string().min(1, 'Date is required'),
  note: z.string().optional(),
});

// ─── Expense requests ────────────────────────────────────────────────────────

export const ExpenseRequestItemSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  quantity: z
    .number({ error: 'Quantity is required' })
    .int()
    .positive('Quantity must be greater than zero'),
  unitPrice: z
    .number({ error: 'Unit price is required' })
    .positive('Unit price must be greater than zero'),
});

export const CreateExpenseRequestSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  type: z.enum(['PURCHASE_ORDER', 'UTILITY_BILL', 'FUEL', 'SALARY_ADVANCE', 'MAINTENANCE', 'OTHER']),
  department: z.string().min(1, 'Department is required'),
  justification: z.string().min(1, 'Justification is required'),
  currency: z.enum(['USD', 'ZIG']),
  items: z.array(ExpenseRequestItemSchema).min(1, 'Add at least one item'),
});

export const RejectExpenseRequestSchema = z.object({
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
});

export const DisburseExpenseRequestSchema = z.object({
  actualTotal: z
    .number({ error: 'Please enter an amount' })
    .positive('Amount must be greater than zero'),
  paymentMethod: z.enum(['CASH', 'ECOCASH', 'SWIPE', 'ZIPIT']),
  disbursementNote: z.string().optional(),
});

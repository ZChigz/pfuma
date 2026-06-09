import { z } from 'zod';

export const CreateStudentSchema = z.object({
  fullName: z.string().min(1),
  grade: z.string().min(1),
  parentName: z.string().min(1),
  parentPhone: z.string().min(1),
});

export const UpdateStudentSchema = CreateStudentSchema.partial().extend({
  active: z.boolean().optional(),
});

export const CreateChargeSchema = z.object({
  studentId: z.string().min(1),
  label: z.string().min(1),
  currency: z.enum(['USD', 'ZIG']),
  amount: z.number().positive(),
  term: z.string().min(1),
});

export const CreateFeeStructureSchema = z.object({
  grade: z.string().min(1),
  term: z.string().min(1),
  label: z.string().min(1),
  currency: z.enum(['USD', 'ZIG']),
  amount: z.number().positive(),
});

export const ApplyFeeStructureSchema = z.object({
  feeStructureId: z.string().min(1),
  studentIds: z.array(z.string().min(1)).min(1),
});

export const CreatePaymentSchema = z
  .object({
    studentId: z.string().min(1),
    currency: z.enum(['USD', 'ZIG']),
    amount: z
      .number({ invalid_type_error: 'Please enter an amount' })
      .positive('Amount must be greater than zero'),
    method: z.enum(['CASH', 'ECOCASH', 'SWIPE', 'ZIPIT']),
    reference: z.string().optional(),
    feeLabel: z.string().min(1, 'Fee label is required'),
    popUrl: z.string().optional(),
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
    .number({ invalid_type_error: 'Please enter an amount' })
    .positive('Amount must be greater than zero'),
  spentOn: z.string().min(1, 'Date is required'),
  note: z.string().optional(),
});

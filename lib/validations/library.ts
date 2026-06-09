import { z } from 'zod';

export const CreateBookSchema = z.object({
  isbn:          z.string().optional(),
  title:         z.string().min(1, 'Title is required'),
  author:        z.string().min(1, 'Author is required'),
  subject:       z.string().optional(),
  publisher:     z.string().optional(),
  year:          z.number().int().min(1000).max(new Date().getFullYear() + 1).optional(),
  shelfLocation: z.string().optional(),
  coverUrl:      z.string().url('Invalid URL').optional().or(z.literal('')),
  totalCopies:   z.number().int().positive('Must have at least 1 copy'),
});

export const CheckoutSchema = z.object({
  copyId:   z.string().min(1, 'Copy is required'),
  memberId: z.string().min(1, 'Member is required'),
  dueDate:  z.string().optional(),
});

export const ReturnSchema = z.object({
  conditionOnReturn: z.enum(['NEW', 'GOOD', 'FAIR', 'DAMAGED']),
  fineSettled:       z.boolean().optional(),
});

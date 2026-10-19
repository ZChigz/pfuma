import { z } from 'zod';
import { MODULE_KEYS } from '@/lib/access-core';
import { PRESET_KEYS } from '@/lib/platform/presets';
import { email, mobile, personName, PROVINCES, SCHOOL_TYPES } from '@/lib/validations/system';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31').refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'That date does not exist');
const blankToNull = <T extends z.ZodTypeAny>(s: T) => s.or(z.literal('')).transform((v) => (v === '' ? null : v)).nullable().optional();

export const PlatformLoginSchema = z.object({ email: z.string().trim().min(3).max(254), password: z.string().min(1).max(200) });

const person = z.object({ fullName: personName, email, phone: mobile });

export const CreateSchoolSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the school name').max(120, 'The school name can be at most 120 characters'),
    schoolType: z.enum(SCHOOL_TYPES, { error: 'Choose the type of school' }),
    province: z.enum(PROVINCES, { error: 'Choose the province' }),
    preset: z.enum(PRESET_KEYS, { error: 'Choose a preset' }),
    planId: blankToNull(z.string().min(1).max(60)),
    studentLimit: z.coerce.number().int().min(1).max(100_000).nullable().optional().or(z.literal('').transform(() => null)),
    status: z.enum(['TRIAL', 'ACTIVE']).default('TRIAL'),
    renewalDate: blankToNull(isoDate),
    owner: person,
    administrator: person,
  })
  .superRefine((d, ctx) => {
    if (d.owner.email === d.administrator.email) ctx.addIssue({ code: 'custom', path: ['administrator', 'email'], message: 'The Owner and the Administrator need different email addresses' });
  });

export const ModulesPatchSchema = z
  .object({ modules: z.record(z.string(), z.boolean()).optional(), preset: z.enum(PRESET_KEYS).optional() })
  .superRefine((d, ctx) => {
    if (!d.modules && !d.preset) ctx.addIssue({ code: 'custom', message: 'Nothing to change' });
    for (const [key, on] of Object.entries(d.modules ?? {})) {
      if (!MODULE_KEYS.includes(key)) ctx.addIssue({ code: 'custom', path: ['modules', key], message: `Unknown module "${key}"` });
      if (key === 'system' && !on) ctx.addIssue({ code: 'custom', path: ['modules', key], message: 'Dashboard & System cannot be switched off' });
    }
  });

export const BillingPatchSchema = z
  .object({
    planId: blankToNull(z.string().min(1).max(60)),
    studentLimit: z.coerce.number().int().min(1).max(100_000).nullable().optional().or(z.literal('').transform(() => null)),
    renewalDate: blankToNull(isoDate),
    status: z.enum(['TRIAL', 'ACTIVE', 'OVERDUE']).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Nothing to change' });

export const SuspendSchema = z.object({ reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300) });

export const CreateInvoiceSchema = z.object({
  amount: z.coerce.number().positive('Enter an amount above zero').max(10_000_000),
  currency: z.enum(['USD', 'ZIG']).default('USD'),
  description: z.string().trim().min(3, 'Describe what it is for').max(200),
  issuedOn: isoDate.optional(),
  dueOn: blankToNull(isoDate),
});

export const MarkPaidSchema = z.object({ paidOn: isoDate.optional() });

export const SupportStartSchema = z.object({ reason: z.string().trim().min(10, 'Say why you need to look in (at least 10 characters)').max(300) });

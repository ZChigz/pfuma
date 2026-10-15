import { z } from 'zod';
import { MODULE_KEYS } from '@/lib/access-core';

export const ROLES = ['ADMIN', 'DIRECTOR', 'HEAD', 'BURSAR', 'TEACHER', 'LIBRARIAN'] as const;

const fullName = z.string().trim().min(2, 'Enter the full name').max(100, 'The name is too long');
const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254, 'The email is too long');
const optionalText = (max: number) =>
  z.string().trim().max(max, `Use ${max} characters or fewer`).transform((v) => (v === '' ? null : v)).nullable().optional();

// ─── Users ───────────────────────────────────────────────────────────────────

export const SystemCreateUserSchema = z.object({
  fullName,
  email,
  role: z.enum(ROLES),
});

export const SystemUpdateUserSchema = z
  .object({
    fullName: fullName.optional(),
    email: email.optional(),
    role: z.enum(ROLES).optional(),
  })
  .refine((d) => d.fullName !== undefined || d.email !== undefined || d.role !== undefined, { message: 'Nothing to update' });

// ─── School settings ─────────────────────────────────────────────────────────

export const SchoolSettingsSchema = z.object({
  name: z.string().trim().min(2, 'Enter the school name').max(120, 'The name is too long'),
  schoolType: z.enum(['GOVERNMENT', 'PRIVATE']),
  location: optionalText(120),
  address: optionalText(250),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a phone number such as +263 242 123456')
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254).or(z.literal('')).transform((v) => (v === '' ? null : v)).nullable().optional(),
  motto: optionalText(150),
  logoUrl: z
    .string()
    .trim()
    .url('Enter a web address')
    .refine((u) => /^https:\/\/(utfs\.io|[a-z0-9-]+\.ufs\.sh)\//.test(u), 'Upload the logo again; only uploaded images can be used')
    .max(500)
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  defaultCurrency: z.enum(['USD', 'ZIG']),
  maxClassSize: z.number({ error: 'Class size must be a number' }).int('Class size must be a whole number').min(1, 'At least 1').max(200, 'At most 200'),
});

// ─── Calendar ────────────────────────────────────────────────────────────────

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'That date does not exist');

export const CalendarEventSchema = z
  .object({
    title: z.string().trim().min(2, 'Enter a title').max(120, 'The title is too long'),
    kind: z.enum(['HOLIDAY', 'EXAM', 'SPORTS', 'MEETING', 'OTHER']),
    startDate: isoDate,
    endDate: isoDate,
    notes: optionalText(500),
  })
  .refine((d) => d.endDate >= d.startDate, { message: 'The end date cannot be before the start date', path: ['endDate'] });

export const CalendarEventUpdateSchema = CalendarEventSchema;

export const CalendarRangeSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

// ─── Modules ─────────────────────────────────────────────────────────────────

export const ModulesSchema = z
  .object({ modules: z.record(z.string(), z.boolean()) })
  .superRefine((d, ctx) => {
    for (const [key, on] of Object.entries(d.modules)) {
      if (!MODULE_KEYS.includes(key)) ctx.addIssue({ code: 'custom', message: `Unknown module "${key}"`, path: ['modules', key] });
      if (key === 'system' && !on) ctx.addIssue({ code: 'custom', message: 'Dashboard & System cannot be switched off', path: ['modules', key] });
    }
  });

// ─── Term switcher, notifications, profile ───────────────────────────────────

export const ViewTermSchema = z.object({ termId: z.string().min(1).max(60) });

export const NotificationReadSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ id: z.string().min(1).max(60) }),
]);

export const ProfileSchema = z.object({ fullName });

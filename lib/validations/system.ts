import { z } from 'zod';
import { MODULE_KEYS } from '@/lib/access-core';
import { normalizeZimbabwePhone } from '@/lib/phone';

export const PROVINCES = [
  'Bulawayo', 'Harare', 'Manicaland', 'Mashonaland Central', 'Mashonaland East', 'Mashonaland West',
  'Masvingo', 'Matabeleland North', 'Matabeleland South', 'Midlands',
] as const;

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

export const SCHOOL_TYPES = ['GOVERNMENT', 'COUNCIL', 'MISSION_CHURCH', 'TRUST', 'PRIVATE'] as const;
export const BOARDING_TYPES = ['DAY', 'BOARDING', 'DAY_AND_BOARDING'] as const;
export const GENDER_TYPES = ['BOYS', 'GIRLS', 'CO_ED'] as const;

/** An image the school uploaded through UploadThing (a logo or a signature): nothing else is accepted. */
const uploadedImage = z
  .string()
  .trim()
  .url('Upload the image again')
  .max(500)
  .refine((u) => /^https:\/\/(utfs\.io|[a-z0-9-]+\.ufs\.sh)\//.test(u), 'Upload the image again; only uploaded images can be used');

const blankToNull = <T extends z.ZodTypeAny>(schema: T) =>
  schema.or(z.literal('')).transform((v) => (v === '' ? null : v)).nullable().optional();

/** Optional short text: trimmed, a blank becomes empty, and a maximum length. */
const text = (label: string, max: number) =>
  z.string().trim().max(max, `${label} can be at most ${max} characters`).or(z.literal('')).transform((v) => (v === '' ? null : v)).nullable().optional();

// Tab 1: School profile
export const SchoolProfileSchema = z.object({
  name: z.string().trim().min(2, 'Enter the school name').max(120, 'The school name can be at most 120 characters'),
  motto: text('The motto', 150),
  logoUrl: blankToNull(uploadedImage),
  schoolType: z.enum(SCHOOL_TYPES, { error: 'Choose the type of school' }),
  responsibleAuthority: text('The responsible authority', 120),
  boarding: z.enum(BOARDING_TYPES, { error: 'Choose day, boarding, or day and boarding' }),
  studentGender: z.enum(GENDER_TYPES, { error: 'Choose boys, girls or co-educational' }),
  // ZIMSEC is always on, so it is not a field; Cambridge is the only choice.
  offersCambridge: z.boolean().default(false),
  zimsecCentreNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,10}$/, 'Use 3 to 10 letters or digits, as printed on your ZIMSEC papers')
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  emisNumber: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9/-]{2,20}$/, 'Use 2 to 20 letters, digits, / or -')
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  province: z.enum(PROVINCES, { error: 'Choose a province' }).or(z.literal('')).transform((v) => (v === '' ? null : v)).nullable().optional(),
  district: z.string().trim().min(2, 'Enter the district').max(80, 'The district can be at most 80 characters'),
  physicalAddress: z.string().trim().min(5, 'Enter the physical address').max(250, 'The address can be at most 250 characters'),
  postalAddress: text('The postal address', 250),
  phone: z
    .string()
    .trim()
    .or(z.literal(''))
    .transform((v, ctx) => {
      if (v === '') return null;
      const n = normalizeZimbabwePhone(v);
      if (!n) ctx.addIssue({ code: 'custom', message: 'Enter a Zimbabwe number such as 0242 700123 or +263 77 123 4567' });
      return n;
    })
    .nullable()
    .optional(),
  email: blankToNull(z.string().trim().toLowerCase().email('Enter a valid email address').max(254)),
  website: blankToNull(
    z
      .string()
      .trim()
      .max(200, 'The website address is too long')
      .regex(/^https?:\/\/[^\s]+\.[^\s]+$/i, 'Start with http:// or https://, e.g. https://www.school.co.zw'),
  ),
  headName: text("The head's name", 100),
  headSignatureUrl: blankToNull(uploadedImage),
});

// Tab 2 (for now): defaults other modules read
export const SchoolDefaultsSchema = z.object({
  defaultCurrency: z.enum(['USD', 'ZIG']),
  maxClassSize: z.number({ error: 'Class size must be a number' }).int('Class size must be a whole number').min(1, 'At least 1').max(200, 'At most 200'),
  receiptPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,8}$/, 'Use 1 to 8 letters or digits, e.g. RCT')
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  receiptNextNumber: z.number({ error: 'Receipt number must be a number' }).int('Whole number only').min(1, 'At least 1').max(99_999_999).optional(),
  setupChecklistPinned: z.boolean().optional(),
});

// ─── Calendar ────────────────────────────────────────────────────────────────

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'That date does not exist');

/** Stored event types. Term dates are not here: they come from the academic terms. */
export const EVENT_KINDS = ['PUBLIC_HOLIDAY', 'EXAM', 'MEETING', 'SPORTS', 'CULTURAL', 'VISITING_DAY', 'PRIZE_GIVING', 'OTHER'] as const;
export const AUDIENCES = ['ALL_STAFF', 'FORMS', 'CLASSES', 'BOARDERS'] as const;
export const REPEATS = ['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export const MAX_REPEAT_YEARS = 5;

const clock = z
  .string()
  .trim()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use a time such as 08:30')
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const idList = z.array(z.string().min(1).max(60)).max(60).optional();

export const CalendarEventSchema = z
  .object({
    title: z.string().trim().min(1, 'Enter a title').max(120, 'The title can be at most 120 characters'),
    kind: z.enum(EVENT_KINDS),
    startDate: isoDate,
    endDate: isoDate,
    allDay: z.boolean().default(true),
    startTime: clock,
    endTime: clock,
    audience: z.enum(AUDIENCES).default('ALL_STAFF'),
    audienceLevelIds: idList,
    audienceClassIds: idList,
    location: optionalText(120),
    notes: optionalText(1000),
    repeat: z.enum(REPEATS).default('NONE'),
    repeatUntil: isoDate.or(z.literal('')).transform((v) => (v === '' ? null : v)).nullable().optional(),
    /** Set after the person confirmed the warnings the server sent back. */
    acknowledged: z.boolean().optional(),
  })
  .superRefine((d, ctx) => {
    const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (d.endDate < d.startDate) bad('endDate', 'The end date cannot be before the start date');
    if (!d.allDay) {
      if (!d.startTime) bad('startTime', 'Enter a start time, or switch on All day');
      if (!d.endTime) bad('endTime', 'Enter an end time, or switch on All day');
      if (d.startTime && d.endTime && d.startDate === d.endDate && d.endTime < d.startTime) bad('endTime', 'The end time cannot be before the start time');
    }
    if (d.audience === 'FORMS' && !d.audienceLevelIds?.length) bad('audienceLevelIds', 'Choose at least one form');
    if (d.audience === 'CLASSES' && !d.audienceClassIds?.length) bad('audienceClassIds', 'Choose at least one class');
    if (d.repeat !== 'NONE') {
      if (!d.repeatUntil) bad('repeatUntil', 'Enter the date the repeats stop');
      else if (d.repeatUntil < d.startDate) bad('repeatUntil', 'The repeats cannot stop before the event starts');
      else {
        const limit = new Date(`${d.startDate}T00:00:00Z`);
        limit.setUTCFullYear(limit.getUTCFullYear() + MAX_REPEAT_YEARS);
        if (d.repeatUntil > limit.toISOString().slice(0, 10)) bad('repeatUntil', `Repeats can run for at most ${MAX_REPEAT_YEARS} years`);
      }
    }
  })
  .transform((d) => ({
    ...d,
    // Only the fields that belong to the chosen options are kept.
    startTime: d.allDay ? null : d.startTime ?? null,
    endTime: d.allDay ? null : d.endTime ?? null,
    audienceLevelIds: d.audience === 'FORMS' ? Array.from(new Set(d.audienceLevelIds ?? [])) : [],
    audienceClassIds: d.audience === 'CLASSES' ? Array.from(new Set(d.audienceClassIds ?? [])) : [],
    repeatUntil: d.repeat === 'NONE' ? null : d.repeatUntil ?? null,
  }));

export const CalendarEventUpdateSchema = CalendarEventSchema;

export const CalendarRangeSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.enum([...EVENT_KINDS, 'TERM']).optional(),
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

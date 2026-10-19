import { z } from 'zod';
import { MODULE_KEYS } from '@/lib/access-core';
import { normalizeZimbabwePhone } from '@/lib/phone';
import { maxCounter, parseFormat } from '@/lib/numbering';
import { validateBoundaries } from '@/lib/results';
import { capitalizeName } from '@/lib/names';
import { STAFF_ROLE_KEYS } from '@/lib/staff-roles';
import { normalizeZimMobile } from '@/lib/students/registration';

export const PROVINCES = [
  'Bulawayo', 'Harare', 'Manicaland', 'Mashonaland Central', 'Mashonaland East', 'Mashonaland West',
  'Masvingo', 'Matabeleland North', 'Matabeleland South', 'Midlands',
] as const;

export const ROLES = ['ADMIN', 'DIRECTOR', 'HEAD', 'BURSAR', 'TEACHER', 'LIBRARIAN'] as const;

export const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254, 'The email is too long');
const optionalText = (max: number) =>
  z.string().trim().max(max, `Use ${max} characters or fewer`).transform((v) => (v === '' ? null : v)).nullable().optional();

// ─── Users ───────────────────────────────────────────────────────────────────

/** A staff member's name: 2 to 80 characters, tidied ("tendai MOYO" becomes "Tendai Moyo"). */
export const personName = z
  .string()
  .trim()
  .min(2, 'Enter the full name (at least 2 characters)')
  .max(80, 'The name can be at most 80 characters')
  .transform(capitalizeName);

/** A Zimbabwe mobile number in any usual spelling, stored as +263XXXXXXXXX. */
export const mobile = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizeZimMobile(v);
    if (!n) ctx.addIssue({ code: 'custom', message: 'Enter a Zimbabwe mobile number such as 0771 234 567 or +263 77 123 4567' });
    return n ?? '';
  });

const staffRoles = z
  .array(z.enum(STAFF_ROLE_KEYS, { error: 'Choose from the list of roles' }))
  .min(1, 'Choose at least one role')
  .max(STAFF_ROLE_KEYS.length)
  .transform((r) => Array.from(new Set(r)));

export const USER_TITLES = ['Mr', 'Mrs', 'Ms', 'Dr'] as const;
const title = z.enum(USER_TITLES).or(z.literal('')).transform((v) => (v === '' ? null : v)).nullable().optional();

export const SIGN_IN_SETUPS = ['INVITE', 'TEMP_PASSWORD'] as const;

export const SystemCreateUserSchema = z.object({
  fullName: personName,
  email,
  phone: mobile,
  roles: staffRoles,
  title,
  signIn: z.enum(SIGN_IN_SETUPS).default('INVITE'),
});

export const SystemUpdateUserSchema = z
  .object({
    fullName: personName.optional(),
    email: email.optional(),
    phone: mobile.optional(),
    roles: staffRoles.optional(),
    title,
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Nothing to update' });

export const ImportUsersSchema = z.object({
  csv: z.string().min(1, 'Choose a file with at least one row').max(300_000, 'The file is too big (at most 300 KB)'),
});

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

// Small defaults that live on other tabs: the class capacity (Forms, streams and classes) and the
// dashboard checklist switch (School profile). Either may be sent on its own.
export const SchoolDefaultsSchema = z
  .object({
    maxClassSize: z.number({ error: 'Class size must be a number' }).int('Class size must be a whole number').min(1, 'At least 1').max(200, 'At most 200').optional(),
    setupChecklistPinned: z.boolean().optional(),
  })
  .refine((d) => d.maxClassSize !== undefined || d.setupChecklistPinned !== undefined, { message: 'Nothing to save' });

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

// My profile: a person's own name, phone and photo (their email and roles are changed by an administrator).
export const ProfileSchema = z
  .object({ fullName: personName.optional(), phone: mobile.optional(), photoUrl: blankToNull(uploadedImage) })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Nothing to update' });

// ─── Academic years and terms (Settings tab 2) ───────────────────────────────

const termDates = z.object({ startDate: isoDate, endDate: isoDate });

export const CreateYearSchema = z
  .object({
    year: z.number({ error: 'Year must be a number' }).int('Year must be a whole number').min(2000, 'Year must be 2000 or later').max(2100, 'Year must be 2100 or earlier'),
    terms: z.array(termDates).length(3, 'A year has three terms'),
  })
  .superRefine((d, ctx) => {
    const y = String(d.year);
    d.terms.forEach((t, i) => {
      const n = i + 1;
      if (t.endDate < t.startDate) ctx.addIssue({ code: 'custom', path: ['terms', i, 'endDate'], message: `Term ${n} must end on or after the day it starts` });
      if (t.startDate < `${y}-01-01` || t.endDate > `${y}-12-31`) ctx.addIssue({ code: 'custom', path: ['terms', i, 'startDate'], message: `Term ${n} must fall inside ${y}` });
      if (i > 0 && t.startDate <= d.terms[i - 1].endDate) ctx.addIssue({ code: 'custom', path: ['terms', i, 'startDate'], message: `Term ${n} must start after Term ${n - 1} ends` });
    });
  });

export const UpdateTermDatesSchema = termDates.refine((t) => t.endDate >= t.startDate, { message: 'The term must end on or after the day it starts', path: ['endDate'] });

// ─── Forms, streams and classes (tab 3) ──────────────────────────────────────

export const FormsSchema = z.object({
  forms: z.array(z.object({ id: z.string().min(1).max(60), active: z.boolean() })).min(1).max(6),
});

export const StreamNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter a stream name')
    .max(30, 'A stream name can be at most 30 characters')
    .regex(/^[A-Za-z0-9 ]+$/, 'Use letters, numbers and spaces only'),
});

export const ClassGridSchema = z.object({
  cells: z
    .array(
      z.object({
        levelId: z.string().min(1).max(60),
        // The stream's name; "" is a form with a single class and no stream.
        stream: z.string().trim().max(30),
        exists: z.boolean(),
        capacity: z.number({ error: 'Capacity must be a number' }).int('Capacity must be a whole number').min(1, 'Capacity must be at least 1').max(200, 'Capacity can be at most 200'),
      }),
    )
    .min(1)
    .max(240),
});

// ─── Grading (tab 4) ─────────────────────────────────────────────────────────

export const GRADE_CATEGORIES = ['O_LEVEL', 'A_LEVEL'] as const;

export const GradeScaleSchema = z.object({
  rows: z
    .array(
      z.object({
        letterGrade: z.string().trim().min(1, 'Enter a grade').max(3, 'A grade can be at most 3 characters'),
        minPercent: z.number({ error: 'Lowest % must be a number' }),
        maxPercent: z.number({ error: 'Highest % must be a number' }),
        points: z.number({ error: 'Points must be a number' }).int('Points must be a whole number').min(0, 'Points cannot be negative').max(100).nullable().optional(),
        remark: z.string().trim().max(60, 'A remark can be at most 60 characters').or(z.literal('')).transform((v) => (v === '' ? null : v)).nullable().optional(),
      }),
    )
    .min(2, 'A scale needs at least two grades')
    .max(15, 'A scale can have at most 15 grades'),
}).superRefine((d, ctx) => {
  const problem = validateBoundaries(d.rows);
  if (problem) ctx.addIssue({ code: 'custom', path: ['rows'], message: problem });
});

// ─── Finance basics (tab 5) ──────────────────────────────────────────────────

const numberFormat = (label: string) =>
  z.string().trim().superRefine((v, ctx) => {
    const r = parseFormat(v);
    if (!r.ok) ctx.addIssue({ code: 'custom', message: `${label}: ${r.error}` });
  });

const nextNumber = z.number({ error: 'Enter a number' }).int('Whole number only').min(1, 'At least 1');

export const FinanceSettingsSchema = z
  .object({
    currencyUsdEnabled: z.boolean(),
    currencyZigEnabled: z.boolean(),
    defaultCurrency: z.enum(['USD', 'ZIG']),
    receiptFormat: numberFormat('Receipt format'),
    receiptNextNumber: nextNumber,
    invoiceFormat: numberFormat('Invoice format'),
    invoiceNextNumber: nextNumber,
  })
  .superRefine((d, ctx) => {
    if (!d.currencyUsdEnabled && !d.currencyZigEnabled) ctx.addIssue({ code: 'custom', path: ['currencyUsdEnabled'], message: 'Switch on at least one currency' });
    if ((d.defaultCurrency === 'USD' && !d.currencyUsdEnabled) || (d.defaultCurrency === 'ZIG' && !d.currencyZigEnabled)) {
      ctx.addIssue({ code: 'custom', path: ['defaultCurrency'], message: 'The currency shown first must be switched on' });
    }
    for (const [key, fmt, n] of [['receiptNextNumber', d.receiptFormat, d.receiptNextNumber], ['invoiceNextNumber', d.invoiceFormat, d.invoiceNextNumber]] as const) {
      const max = maxCounter(fmt);
      if (max > 0 && n > max) ctx.addIssue({ code: 'custom', path: [key], message: `This number is too big for the format (the most it can hold is ${max})` });
    }
  });

// ─── Numbering (tab 6) ───────────────────────────────────────────────────────

export const NumberingSchema = z.object({
  schoolCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,8}$/, 'Use 1 to 8 letters or digits, e.g. CHS'),
  admissionFormat: numberFormat('Admission number format'),
});

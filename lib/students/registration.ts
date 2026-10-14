// Student admission rules — shared by the Register Student form (client), the
// admission API and the CSV import so all three validate identically.
// Must stay free of server-only imports.
import { z } from 'zod';
import { LEVEL_DEFINITIONS, normalizeStream, parseLevelOrder } from '@/lib/academic/rules';

// ─── Reference lists ─────────────────────────────────────────────────────────

export const LEVELS = LEVEL_DEFINITIONS.map((l) => l.name) as unknown as readonly [
  'Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5', 'Form 6',
];
export type LevelName = (typeof LEVELS)[number];
export { DEFAULT_STREAMS } from '@/lib/academic/rules';

export const GENDER_OPTIONS = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
] as const;

export const RELATIONSHIP_OPTIONS = [
  { value: 'FATHER',      label: 'Father' },
  { value: 'MOTHER',      label: 'Mother' },
  { value: 'UNCLE',       label: 'Uncle' },
  { value: 'AUNT',        label: 'Aunt' },
  { value: 'GRANDPARENT', label: 'Grandparent' },
  { value: 'SIBLING',     label: 'Sibling' },
  { value: 'GUARDIAN',    label: 'Guardian' },
  { value: 'OTHER',       label: 'Other' },
] as const;
export const RELATIONSHIPS = ['FATHER', 'MOTHER', 'UNCLE', 'AUNT', 'GRANDPARENT', 'SIBLING', 'GUARDIAN', 'OTHER'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const STUDENT_STATUS_OPTIONS = [
  { value: 'ACTIVE',      label: 'Active' },
  { value: 'TRANSFERRED', label: 'Transferred' },
  { value: 'SUSPENDED',   label: 'Suspended' },
  { value: 'GRADUATED',   label: 'Graduated' },
  { value: 'WITHDRAWN',   label: 'Withdrawn' },
] as const;

export const OTHER_SUBURB = 'Other';
export const SUBURBS = [
  'Arcadia', 'Avondale', 'Belvedere', 'Borrowdale', 'Budiriro', 'Chikurubi',
  'Dzivarasekwa', 'Eastlea', 'Epworth', 'Glen Lorne', 'Glen Norah', 'Glen View',
  'Greendale', 'Greystone Park', 'Hatcliffe', 'Hatfield', 'Highfield', 'Highlands',
  'Hopley', 'Kambuzuma', 'Kuwadzana', 'Mabelreign', 'Mabvuku', 'Mandara',
  'Marimba Park', 'Marlborough', 'Mbare', 'Milton Park', 'Mount Pleasant',
  'Msasa', 'Mufakose', 'Ruwa', 'Southerton', 'Sunningdale', 'Tafara',
  'Warren Park', 'Waterfalls', 'Westgate', OTHER_SUBURB,
] as const;

export const DEFAULT_CITY = 'Harare';
export const DEFAULT_MAX_CLASS_SIZE = 45;
export const MIN_ADMISSION_DATE = '2000-01-01';

// Typical age range per level. Outside it is a warning, never a hard block.
export const LEVEL_AGE_RANGES: Record<LevelName, [number, number]> = {
  'Form 1': [12, 14],
  'Form 2': [13, 15],
  'Form 3': [14, 16],
  'Form 4': [15, 17],
  'Form 5': [16, 18],
  'Form 6': [17, 19],
};

export const WARNING_CODES = ['AGE_OUT_OF_RANGE', 'CLASS_FULL', 'POSSIBLE_DUPLICATE'] as const;
export type WarningCode = (typeof WARNING_CODES)[number];
export interface RegistrationWarning {
  code: WarningCode;
  message: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// The school is in Zimbabwe; servers run in UTC. Using Harare's calendar date
// keeps "not in the future" checks identical on client and server.
export function todayInHarare(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Harare', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function currentYearInHarare(): number {
  return Number(todayInHarare().slice(0, 4));
}

export function className(level: string, stream: string): string {
  return stream ? `${level} ${stream}` : level;
}

// Trims, collapses spaces, and capitalises each part of a name.
// All-lower or ALL-CAPS parts are title-cased; mixed-case parts such as
// "McDonald" are left as typed.
export function normalizeName(raw: string): string {
  const collapsed = raw.replace(/[’‘`]/g, "'").trim().replace(/\s+/g, ' ');
  return collapsed.replace(/[^\s'-]+/g, (part) => {
    const isUniform = part === part.toLowerCase() || part === part.toUpperCase();
    if (!isUniform) return part;
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  });
}

// Letters (any alphabet), single spaces, hyphens and apostrophes between letters.
// Built with RegExp() because the tsconfig target predates the literal /u flag.
const NAME_PATTERN = new RegExp("^\\p{L}+(?:[ '-]\\p{L}+)*$", 'u');
const STREAM_PATTERN = new RegExp('^[\\p{L}\\d]+(?: [\\p{L}\\d]+)*$', 'u');

// Accepts 07X…, 7X…, 263… or +263… with spaces/dashes; returns +263XXXXXXXXX.
// Valid Zimbabwean mobile prefixes: 71 (NetOne), 73 (Telecel), 77/78 (Econet).
export function normalizeZimMobile(raw: string): string | null {
  const compact = raw.replace(/[\s\-().]/g, '');
  const match = compact.match(/^(?:\+263|00263|263|0)?(7[1378]\d{7})$/);
  return match ? `+263${match[1]}` : null;
}

export function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Whole years between two YYYY-MM-DD dates.
export function ageOn(dateOfBirth: string, onDate: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number);
  const [y, m, d] = onDate.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

export function ageWarning(dateOfBirth: string, level: string, today = todayInHarare()): string | null {
  if (!isRealIsoDate(dateOfBirth) || !(level in LEVEL_AGE_RANGES)) return null;
  const [min, max] = LEVEL_AGE_RANGES[level as LevelName];
  const age = ageOn(dateOfBirth, today);
  if (age >= min && age <= max) return null;
  return `This student is ${age} years old. ${level} students are usually ${min}–${max}. Please double-check the date of birth and level.`;
}

export function buildAddress(houseNumber: string, suburb: string, city: string): string {
  return `${houseNumber}, ${suburb}, ${city}`;
}

export function formatAdmissionNumber(admissionYear: number, sequence: number): string {
  return `STU${admissionYear}${String(sequence).padStart(4, '0')}`;
}

// ─── Field schemas ───────────────────────────────────────────────────────────

const custom = (ctx: z.RefinementCtx, message: string, path?: string[]) =>
  ctx.addIssue({ code: 'custom', message, ...(path ? { path } : {}) });

function personName(label: string) {
  return z
    .string({ error: `${label} is required` })
    .transform(normalizeName)
    .superRefine((v, ctx) => {
      if (!v) custom(ctx, `${label} is required`);
      else if (v.length < 2) custom(ctx, `${label} must be at least 2 characters`);
      else if (v.length > 50) custom(ctx, `${label} must be 50 characters or fewer`);
      else if (!NAME_PATTERN.test(v)) custom(ctx, `${label} can only contain letters, spaces, hyphens (-) and apostrophes (')`);
    });
}

function mobilePhone(label: string, required: boolean) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const v = (raw ?? '').trim();
      if (!v) {
        if (required) custom(ctx, `${label} is required`);
        return null;
      }
      const normalized = normalizeZimMobile(v);
      if (!normalized) {
        custom(ctx, `${label} must be a Zimbabwean mobile number starting with 071, 073, 077, 078 or +263 (e.g. 0771234567)`);
        return null;
      }
      return normalized;
    });
}

// Optional free text: blank becomes null; otherwise trimmed and length-checked.
function optionalText(label: string, max: number, pattern?: { re: RegExp; message: string }) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const v = (raw ?? '').trim().replace(/\s+/g, ' ');
      if (!v) return null;
      if (v.length > max) custom(ctx, `${label} must be ${max} characters or fewer`);
      else if (pattern && !pattern.re.test(v)) custom(ctx, pattern.message);
      return v;
    });
}

function isoDateField(label: string, opts: { min?: string; minMessage?: string }) {
  return z
    .string({ error: `${label} is required` })
    .trim()
    .superRefine((v, ctx) => {
      if (!v) custom(ctx, `${label} is required`);
      else if (!isRealIsoDate(v)) custom(ctx, `Enter a real ${label.toLowerCase()}`);
      else if (v > todayInHarare()) custom(ctx, `${label} cannot be in the future`);
      else if (opts.min && v < opts.min) custom(ctx, opts.minMessage ?? `${label} is too early`);
    });
}

function choice<const T extends readonly [string, ...string[]]>(values: T, message: string) {
  return z.enum(values, { error: message });
}

// Fields shared by the form and the CSV import.
const commonFields = {
  firstName: personName('First name'),
  surname:   personName('Surname'),
  gender:    choice(['M', 'F'], 'Please select Male or Female'),
  dateOfBirth: isoDateField('Date of birth', {}),

  level: z
    .string({ error: 'Please select a level (Form 1–6)' })
    .transform((v, ctx) => {
      const order = parseLevelOrder(v ?? '');
      if (!order) {
        custom(ctx, 'Please select a level (Form 1–6)');
        return z.NEVER;
      }
      return `Form ${order}` as LevelName;
    }),
  stream: z
    .string({ error: 'Please select a stream' })
    .transform(normalizeStream)
    .superRefine((v, ctx) => {
      if (!v) custom(ctx, 'Please select a stream');
      else if (v.length > 30) custom(ctx, 'Stream must be 30 characters or fewer');
      else if (!STREAM_PATTERN.test(v)) custom(ctx, 'Stream can only contain letters, numbers and spaces');
    }),
  admissionDate: isoDateField('Admission date', {
    min: MIN_ADMISSION_DATE,
    minMessage: 'Admission date must be in 2000 or later',
  }),

  guardianName: personName('Guardian name'),
  guardianRelationship: choice(RELATIONSHIPS, "Please select the guardian's relationship to the student"),
  guardianRelationshipOther: optionalText('Relationship', 30),
  guardianPhone: mobilePhone('Guardian phone', true),
  guardianAltPhone: mobilePhone('Guardian alternative phone', false),
  guardianEmail: optionalText('Guardian email', 100, {
    re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    message: 'Guardian email must look like name@example.com',
  }),
  guardianNationalId: optionalText('Guardian national ID', 20, {
    re: /^[A-Za-z0-9 -]+$/,
    message: 'Guardian national ID can only contain letters, numbers, spaces and -',
  }),
  guardianOccupation: optionalText('Guardian occupation', 60),

  birthCertificateNumber: optionalText('Birth certificate number', 30, {
    re: /^[A-Za-z0-9 /-]+$/,
    message: 'Birth certificate number can only contain letters, numbers, spaces, / and -',
  }),
  previousSchool: optionalText('Previous school', 100),
  medicalNotes:   optionalText('Medical conditions / allergies', 500),
};

type CommonParsed = {
  firstName: string; surname: string; dateOfBirth: string; admissionDate: string;
  guardianName: string; guardianRelationship: Relationship; guardianRelationshipOther: string | null;
  guardianPhone: string | null; guardianAltPhone: string | null;
};

function commonRules(d: CommonParsed, ctx: z.RefinementCtx) {
  if (d.guardianRelationship === 'OTHER' && !d.guardianRelationshipOther) {
    custom(ctx, 'Please type the relationship', ['guardianRelationshipOther']);
  }
  if (d.guardianName && !d.guardianName.includes(' ')) {
    custom(ctx, "Enter the guardian's first name and surname", ['guardianName']);
  }
  if (d.guardianAltPhone && d.guardianAltPhone === d.guardianPhone) {
    custom(ctx, 'Alternative phone is the same as the guardian phone', ['guardianAltPhone']);
  }
  if (isRealIsoDate(d.dateOfBirth) && isRealIsoDate(d.admissionDate) && d.admissionDate < d.dateOfBirth) {
    custom(ctx, 'Admission date cannot be before the date of birth', ['admissionDate']);
  }
}

type CommonOut = {
  firstName: string; surname: string; gender: 'M' | 'F'; dateOfBirth: string; level: LevelName; stream: string;
  admissionDate: string; guardianName: string; guardianRelationship: Relationship; guardianRelationshipOther: string | null;
  guardianPhone: string | null; guardianAltPhone: string | null; guardianEmail: string | null;
  guardianNationalId: string | null; guardianOccupation: string | null;
  birthCertificateNumber: string | null; previousSchool: string | null; medicalNotes: string | null;
};

// Clean admission data produced by both the form and the CSV import.
export interface AdmissionData {
  firstName: string;
  surname: string;
  fullName: string;
  gender: 'M' | 'F';
  dateOfBirth: string;
  level: LevelName;
  stream: string;
  className: string;
  admissionDate: string;
  admissionNumber: string | null; // null = generate
  guardian: {
    fullName: string;
    phone: string;
    altPhone: string | null;
    email: string | null;
    nationalId: string | null;
    occupation: string | null;
    address: string | null;
  };
  relationship: Relationship;
  relationshipNote: string | null;
  birthCertificateNumber: string | null;
  previousSchool: string | null;
  medicalNotes: string | null;
  houseNumber: string | null;
  suburb: string | null;
  city: string | null;
  address: string | null;
  photoUrl: string | null;
}

function commonOutput(d: CommonOut) {
  return {
    firstName:      d.firstName,
    surname:        d.surname,
    fullName:       `${d.firstName} ${d.surname}`,
    gender:         d.gender,
    dateOfBirth:    d.dateOfBirth,
    level:          d.level,
    stream:         d.stream,
    className:      className(d.level, d.stream),
    admissionDate:  d.admissionDate,
    guardian: {
      fullName:   d.guardianName,
      phone:      d.guardianPhone as string,
      altPhone:   d.guardianAltPhone,
      email:      d.guardianEmail?.toLowerCase() ?? null,
      nationalId: d.guardianNationalId?.toUpperCase() ?? null,
      occupation: d.guardianOccupation,
    },
    relationship:     d.guardianRelationship,
    relationshipNote: d.guardianRelationship === 'OTHER' ? d.guardianRelationshipOther : null,
    birthCertificateNumber: d.birthCertificateNumber?.toUpperCase() ?? null,
    previousSchool: d.previousSchool,
    medicalNotes:   d.medicalNotes,
  };
}

// ─── Register Student form ───────────────────────────────────────────────────
// Input: what the form supplies (strings). Output: clean, normalised data.

export const RegisterStudentSchema = z
  .object({
    ...commonFields,
    houseNumber: z
      .string({ error: 'House / stand number is required' })
      .trim()
      .superRefine((v, ctx) => {
        if (!v) custom(ctx, 'House / stand number is required');
        else if (v.length > 30) custom(ctx, 'House / stand number must be 30 characters or fewer');
        else if (!/^[A-Za-z0-9 ,./#-]+$/.test(v)) custom(ctx, 'House / stand number can only contain letters, numbers, spaces and / - , . #');
      }),
    suburb: z
      .string({ error: 'Suburb is required' })
      .trim()
      .superRefine((v, ctx) => {
        if (!v) custom(ctx, 'Please select a suburb');
        else if (!(SUBURBS as readonly string[]).includes(v)) custom(ctx, 'Please pick a suburb from the list, or choose "Other" and type it');
      }),
    suburbOther: optionalText('Suburb', 50),
    city: personName('City'),
    photoUrl: optionalText('Photo', 500, { re: /^https:\/\/\S+$/, message: 'Photo upload failed — please upload it again' }),
  })
  .superRefine((d, ctx) => {
    commonRules(d, ctx);
    if (d.suburb === OTHER_SUBURB && !d.suburbOther) custom(ctx, 'Please type the suburb name', ['suburbOther']);
  })
  .transform((d): AdmissionData => {
    const suburb = d.suburb === OTHER_SUBURB ? normalizeName(d.suburbOther ?? '') : d.suburb;
    const houseNumber = d.houseNumber.toUpperCase();
    const address = buildAddress(houseNumber, suburb, d.city);
    const base = commonOutput(d);
    return {
      ...base,
      guardian: { ...base.guardian, address },
      houseNumber,
      suburb,
      city: d.city,
      address,
      photoUrl: d.photoUrl,
      admissionNumber: null,
    };
  });

export type RegisterStudentInput = z.input<typeof RegisterStudentSchema>;

// ─── CSV import row ──────────────────────────────────────────────────────────
// Same field rules; the address is a single column and the admission number
// may be supplied (otherwise generated).

export const ImportStudentRowSchema = z
  .object({
    ...commonFields,
    address: z
      .string({ error: 'Address is required' })
      .transform((v) => v.trim().replace(/\s+/g, ' '))
      .superRefine((v, ctx) => {
        if (!v) custom(ctx, 'Address is required');
        else if (v.length < 5) custom(ctx, 'Address is too short — include the house/stand number and suburb');
        else if (v.length > 200) custom(ctx, 'Address must be 200 characters or fewer');
      }),
    admissionNumber: optionalText('Admission number', 20, {
      re: /^[A-Za-z0-9/-]{3,20}$/,
      message: 'Admission number can only contain letters, numbers, / and - (3–20 characters)',
    }),
  })
  .superRefine((d, ctx) => commonRules(d, ctx))
  .transform((d): AdmissionData => {
    const base = commonOutput(d);
    return {
      ...base,
      guardian: { ...base.guardian, address: d.address },
      houseNumber: null,
      suburb: null,
      city: null,
      address: d.address,
      photoUrl: null,
      admissionNumber: d.admissionNumber?.toUpperCase() ?? null,
    };
  });

export type ImportStudentRowInput = z.input<typeof ImportStudentRowSchema>;

export const RegisterStudentRequestSchema = z.object({
  student: z.unknown(),
  acknowledgedWarnings: z.array(z.enum(WARNING_CODES)).optional().default([]),
});

// Flattens zod issues to { field: [messages] } for the form to show under each field.
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_form';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function defaultRegistrationValues(): RegisterStudentInput {
  return {
    firstName: '',
    surname: '',
    gender: '' as never,
    dateOfBirth: '',
    level: '',
    stream: '',
    admissionDate: todayInHarare(),
    guardianName: '',
    guardianRelationship: '' as never,
    guardianRelationshipOther: '',
    guardianPhone: '',
    guardianAltPhone: '',
    guardianEmail: '',
    guardianNationalId: '',
    guardianOccupation: '',
    houseNumber: '',
    suburb: '',
    suburbOther: '',
    city: DEFAULT_CITY,
    birthCertificateNumber: '',
    previousSchool: '',
    medicalNotes: '',
    photoUrl: '',
  };
}

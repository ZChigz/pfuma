// Student registration rules — shared by the Register Student form (client),
// the registration API and the CSV import so all three validate identically.
// Must stay free of server-only imports.
import { z } from 'zod';

// ─── Reference lists ─────────────────────────────────────────────────────────

export const FORMS = ['Form 1', 'Form 2', 'Form 3', 'Form 4'] as const;
export const STREAMS = ['North', 'South', 'East'] as const;
export type Form = (typeof FORMS)[number];
export type Stream = (typeof STREAMS)[number];

export const GENDER_OPTIONS = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
] as const;

export const RELATIONSHIPS = [
  'Father', 'Mother', 'Uncle', 'Aunt', 'Grandfather', 'Grandmother',
  'Brother', 'Sister', 'Guardian', 'Other',
] as const;

export const STUDENT_STATUS_OPTIONS = [
  { value: 'ACTIVE',      label: 'Active' },
  { value: 'TRANSFERRED', label: 'Transferred' },
  { value: 'SUSPENDED',   label: 'Suspended' },
  { value: 'GRADUATED',   label: 'Graduated' },
  { value: 'WITHDRAWN',   label: 'Withdrawn' },
] as const;
export const STUDENT_STATUSES = ['ACTIVE', 'TRANSFERRED', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

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
export const MIN_ENROLLMENT_YEAR = 2000;

// Typical age range per form. Outside it is a warning, never a hard block.
export const FORM_AGE_RANGES: Record<Form, [number, number]> = {
  'Form 1': [12, 14],
  'Form 2': [13, 15],
  'Form 3': [14, 16],
  'Form 4': [15, 17],
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

export function className(form: string, stream: string): string {
  return `${form} ${stream}`;
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

export function ageWarning(dateOfBirth: string, form: string, today = todayInHarare()): string | null {
  if (!isRealIsoDate(dateOfBirth) || !(form in FORM_AGE_RANGES)) return null;
  const [min, max] = FORM_AGE_RANGES[form as Form];
  const age = ageOn(dateOfBirth, today);
  if (age >= min && age <= max) return null;
  return `This student is ${age} years old. ${form} students are usually ${min}–${max}. Please double-check the date of birth and form.`;
}

export function buildAddress(houseNumber: string, suburb: string, city: string): string {
  return `${houseNumber}, ${suburb}, ${city}`;
}

export function formatStudentNumber(enrollmentYear: number, sequence: number): string {
  return `STU${enrollmentYear}${String(sequence).padStart(4, '0')}`;
}

// ─── Field schemas ───────────────────────────────────────────────────────────

function personName(label: string) {
  return z
    .string({ error: `${label} is required` })
    .transform(normalizeName)
    .superRefine((v, ctx) => {
      if (!v) ctx.addIssue({ code: 'custom', message: `${label} is required` });
      else if (v.length < 2) ctx.addIssue({ code: 'custom', message: `${label} must be at least 2 characters` });
      else if (v.length > 50) ctx.addIssue({ code: 'custom', message: `${label} must be 50 characters or fewer` });
      else if (!NAME_PATTERN.test(v)) {
        ctx.addIssue({
          code: 'custom',
          message: `${label} can only contain letters, spaces, hyphens (-) and apostrophes (')`,
        });
      }
    });
}

function mobilePhone(label: string, required: boolean) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const v = (raw ?? '').trim();
      if (!v) {
        if (required) ctx.addIssue({ code: 'custom', message: `${label} is required` });
        return null;
      }
      const normalized = normalizeZimMobile(v);
      if (!normalized) {
        ctx.addIssue({
          code: 'custom',
          message: `${label} must be a Zimbabwean mobile number starting with 071, 073, 077, 078 or +263 (e.g. 0771234567)`,
        });
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
      if (v.length > max) ctx.addIssue({ code: 'custom', message: `${label} must be ${max} characters or fewer` });
      else if (pattern && !pattern.re.test(v)) ctx.addIssue({ code: 'custom', message: pattern.message });
      return v;
    });
}

function choice<const T extends readonly [string, ...string[]]>(values: T, message: string) {
  return z.enum(values, { error: message });
}

// ─── Registration schema ─────────────────────────────────────────────────────
// Input: what the form / CSV supplies (strings). Output: clean, normalised data.

export const RegisterStudentSchema = z
  .object({
    firstName: personName('First name'),
    surname:   personName('Surname'),
    gender:    choice(['M', 'F'], 'Please select Male or Female'),

    dateOfBirth: z
      .string({ error: 'Date of birth is required' })
      .trim()
      .superRefine((v, ctx) => {
        if (!v) ctx.addIssue({ code: 'custom', message: 'Date of birth is required' });
        else if (!isRealIsoDate(v)) ctx.addIssue({ code: 'custom', message: 'Enter a real date of birth' });
        else if (v > todayInHarare()) ctx.addIssue({ code: 'custom', message: 'Date of birth cannot be in the future' });
      }),

    form:   choice(FORMS, 'Please select a form (Form 1–4)'),
    stream: choice(STREAMS, 'Please select a stream (North, South or East)'),

    enrollmentYear: z
      .union([z.string(), z.number()], { error: 'Enrollment year is required' })
      .transform((raw, ctx) => {
        const v = String(raw).trim();
        if (!v) {
          ctx.addIssue({ code: 'custom', message: 'Enrollment year is required' });
          return z.NEVER;
        }
        if (!/^\d{4}$/.test(v)) {
          ctx.addIssue({ code: 'custom', message: 'Enrollment year must be a 4-digit year, e.g. 2026' });
          return z.NEVER;
        }
        const year = Number(v);
        if (year > currentYearInHarare()) {
          ctx.addIssue({ code: 'custom', message: 'Enrollment year cannot be in the future' });
        } else if (year < MIN_ENROLLMENT_YEAR) {
          ctx.addIssue({ code: 'custom', message: `Enrollment year must be ${MIN_ENROLLMENT_YEAR} or later` });
        }
        return year;
      }),

    guardianName: personName('Guardian name'),
    guardianRelationship: choice(RELATIONSHIPS, "Please select the guardian's relationship to the student"),
    guardianRelationshipOther: optionalText('Relationship', 30),
    guardianPhone: mobilePhone('Guardian phone', true),

    houseNumber: z
      .string({ error: 'House / stand number is required' })
      .trim()
      .superRefine((v, ctx) => {
        if (!v) ctx.addIssue({ code: 'custom', message: 'House / stand number is required' });
        else if (v.length > 30) ctx.addIssue({ code: 'custom', message: 'House / stand number must be 30 characters or fewer' });
        else if (!/^[A-Za-z0-9 ,./#-]+$/.test(v)) {
          ctx.addIssue({ code: 'custom', message: 'House / stand number can only contain letters, numbers, spaces and / - , . #' });
        }
      }),
    suburb: z
      .string({ error: 'Suburb is required' })
      .trim()
      .superRefine((v, ctx) => {
        if (!v) ctx.addIssue({ code: 'custom', message: 'Please select a suburb' });
        else if (!(SUBURBS as readonly string[]).includes(v)) {
          ctx.addIssue({ code: 'custom', message: 'Please pick a suburb from the list, or choose "Other" and type it' });
        }
      }),
    suburbOther: optionalText('Suburb', 50),
    city: personName('City'),

    status: choice(STUDENT_STATUSES, 'Please select a status'),

    birthCertificateNumber: optionalText('Birth certificate number', 30, {
      re: /^[A-Za-z0-9 /-]+$/,
      message: 'Birth certificate number can only contain letters, numbers, spaces, / and -',
    }),
    previousSchool:      optionalText('Previous school', 100),
    secondGuardianPhone: mobilePhone('Second guardian phone', false),
    medicalNotes:        optionalText('Medical conditions / allergies', 500),
    photoUrl: optionalText('Photo', 500, {
      re: /^https:\/\/\S+$/,
      message: 'Photo upload failed — please upload it again',
    }),
  })
  .superRefine((d, ctx) => {
    if (d.guardianRelationship === 'Other' && !d.guardianRelationshipOther) {
      ctx.addIssue({ code: 'custom', path: ['guardianRelationshipOther'], message: 'Please type the relationship' });
    }
    if (d.suburb === OTHER_SUBURB && !d.suburbOther) {
      ctx.addIssue({ code: 'custom', path: ['suburbOther'], message: 'Please type the suburb name' });
    }
    if (d.guardianName && !d.guardianName.includes(' ')) {
      ctx.addIssue({ code: 'custom', path: ['guardianName'], message: "Enter the guardian's first name and surname" });
    }
    if (d.secondGuardianPhone && d.secondGuardianPhone === d.guardianPhone) {
      ctx.addIssue({ code: 'custom', path: ['secondGuardianPhone'], message: 'Second guardian phone is the same as the guardian phone' });
    }
    if (isRealIsoDate(d.dateOfBirth) && Number.isInteger(d.enrollmentYear)
        && d.enrollmentYear < Number(d.dateOfBirth.slice(0, 4))) {
      ctx.addIssue({ code: 'custom', path: ['enrollmentYear'], message: 'Enrollment year cannot be before the student was born' });
    }
  })
  .transform((d) => {
    const suburb = d.suburb === OTHER_SUBURB ? normalizeName(d.suburbOther ?? '') : d.suburb;
    const guardianRelationship = d.guardianRelationship === 'Other'
      ? normalizeName(d.guardianRelationshipOther ?? '')
      : d.guardianRelationship;
    return {
      firstName:      d.firstName,
      surname:        d.surname,
      fullName:       `${d.firstName} ${d.surname}`,
      gender:         d.gender,
      dateOfBirth:    d.dateOfBirth,
      form:           d.form,
      stream:         d.stream,
      className:      className(d.form, d.stream),
      enrollmentYear: d.enrollmentYear,
      guardianName:   d.guardianName,
      guardianRelationship,
      guardianPhone:  d.guardianPhone as string,
      houseNumber:    d.houseNumber.toUpperCase(),
      suburb,
      city:           d.city,
      address:        buildAddress(d.houseNumber.toUpperCase(), suburb, d.city),
      status:         d.status,
      birthCertificateNumber: d.birthCertificateNumber?.toUpperCase() ?? null,
      previousSchool:      d.previousSchool,
      secondGuardianPhone: d.secondGuardianPhone,
      medicalNotes:        d.medicalNotes,
      photoUrl:            d.photoUrl,
    };
  });

export type RegisterStudentInput = z.input<typeof RegisterStudentSchema>;
export type RegisterStudentData = z.output<typeof RegisterStudentSchema>;

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
    form: '' as never,
    stream: '' as never,
    enrollmentYear: String(currentYearInHarare()),
    guardianName: '',
    guardianRelationship: '' as never,
    guardianRelationshipOther: '',
    guardianPhone: '',
    houseNumber: '',
    suburb: '',
    suburbOther: '',
    city: DEFAULT_CITY,
    status: 'ACTIVE',
    birthCertificateNumber: '',
    previousSchool: '',
    secondGuardianPhone: '',
    medicalNotes: '',
    photoUrl: '',
  };
}

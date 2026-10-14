// CSV parsing and row mapping for bulk student import. Rows are mapped to the
// same input shape as the Register Student form, then validated with
// RegisterStudentSchema, so the import enforces exactly the same rules.
import {
  currentYearInHarare,
  DEFAULT_CITY,
  OTHER_SUBURB,
  RELATIONSHIPS,
  STREAMS,
  STUDENT_STATUS_OPTIONS,
  SUBURBS,
  type RegisterStudentInput,
} from '@/lib/students/registration';

// RFC 4180-style parser: quoted fields may contain commas, quotes ("") and newlines.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export const CSV_COLUMNS = [
  { key: 'firstName',              required: true,  example: 'Tatenda' },
  { key: 'surname',                required: true,  example: 'Moyo' },
  { key: 'gender',                 required: true,  example: 'Male' },
  { key: 'dateOfBirth',            required: true,  example: '2013-04-21' },
  { key: 'form',                   required: true,  example: 'Form 1' },
  { key: 'stream',                 required: true,  example: 'North' },
  { key: 'enrollmentYear',         required: false, example: String(currentYearInHarare()) },
  { key: 'guardianName',           required: true,  example: 'Rudo Moyo' },
  { key: 'guardianRelationship',   required: true,  example: 'Mother' },
  { key: 'guardianPhone',          required: true,  example: '0771234567' },
  { key: 'houseNumber',            required: true,  example: '1234' },
  { key: 'suburb',                 required: true,  example: 'Kuwadzana' },
  { key: 'city',                   required: false, example: DEFAULT_CITY },
  { key: 'status',                 required: false, example: 'Active' },
  { key: 'birthCertificateNumber', required: false, example: '' },
  { key: 'previousSchool',         required: false, example: '' },
  { key: 'secondGuardianPhone',    required: false, example: '' },
  { key: 'medicalNotes',           required: false, example: '' },
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number]['key'];

// "First Name", "first_name" and "firstname" all map to firstName.
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const COLUMN_BY_SQUASHED = new Map<string, CsvColumn>(CSV_COLUMNS.map((c) => [squash(c.key), c.key]));
COLUMN_BY_SQUASHED.set('dob', 'dateOfBirth');
COLUMN_BY_SQUASHED.set('lastname', 'surname');
COLUMN_BY_SQUASHED.set('sex', 'gender');
COLUMN_BY_SQUASHED.set('standnumber', 'houseNumber');

export function mapHeaders(headers: string[]): { index: Partial<Record<CsvColumn, number>>; missing: CsvColumn[] } {
  const index: Partial<Record<CsvColumn, number>> = {};
  headers.forEach((h, i) => {
    const key = COLUMN_BY_SQUASHED.get(squash(h));
    if (key && index[key] === undefined) index[key] = i;
  });
  const missing = CSV_COLUMNS.filter((c) => c.required && index[c.key] === undefined).map((c) => c.key);
  return { index, missing };
}

function matchFrom<T extends string>(list: readonly T[], raw: string): T | undefined {
  const v = raw.trim().toLowerCase();
  return list.find((item) => item.toLowerCase() === v);
}

// Accepts YYYY-MM-DD, YYYY/MM/DD and DD/MM/YYYY (the usual Zimbabwean format).
export function csvDateToIso(raw: string): string {
  const v = raw.trim();
  let m = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return v;
}

export function csvRowToInput(fields: string[], index: Partial<Record<CsvColumn, number>>): RegisterStudentInput {
  const get = (key: CsvColumn) => {
    const i = index[key];
    return i === undefined ? '' : (fields[i] ?? '').trim();
  };

  const genderRaw = get('gender').toLowerCase();
  const gender = genderRaw === 'm' || genderRaw === 'male' ? 'M'
    : genderRaw === 'f' || genderRaw === 'female' ? 'F'
    : get('gender');

  const formRaw = get('form');
  const formDigit = formRaw.match(/^(?:form\s*|f)?([1-4])$/i)?.[1];
  const form = formDigit ? `Form ${formDigit}` : formRaw;

  const relationshipRaw = get('guardianRelationship');
  const relationship = matchFrom(RELATIONSHIPS, relationshipRaw);

  const suburbRaw = get('suburb');
  const suburb = matchFrom(SUBURBS, suburbRaw);

  const statusRaw = get('status');
  const status = statusRaw
    ? STUDENT_STATUS_OPTIONS.find((s) => s.value === statusRaw.toUpperCase() || s.label.toLowerCase() === statusRaw.toLowerCase())?.value ?? statusRaw
    : 'ACTIVE';

  return {
    firstName:   get('firstName'),
    surname:     get('surname'),
    gender:      gender as RegisterStudentInput['gender'],
    dateOfBirth: csvDateToIso(get('dateOfBirth')),
    form:        form as RegisterStudentInput['form'],
    stream:      (matchFrom(STREAMS, get('stream')) ?? get('stream')) as RegisterStudentInput['stream'],
    enrollmentYear: get('enrollmentYear') || String(currentYearInHarare()),
    guardianName: get('guardianName'),
    // Anything not in the list is kept as an "Other" relationship.
    guardianRelationship: (relationship ?? (relationshipRaw ? 'Other' : '')) as RegisterStudentInput['guardianRelationship'],
    guardianRelationshipOther: relationship ? '' : relationshipRaw,
    guardianPhone: get('guardianPhone'),
    houseNumber:   get('houseNumber'),
    suburb:        suburb ?? (suburbRaw ? OTHER_SUBURB : ''),
    suburbOther:   suburb ? '' : suburbRaw,
    city:          get('city') || DEFAULT_CITY,
    status:        status as RegisterStudentInput['status'],
    birthCertificateNumber: get('birthCertificateNumber'),
    previousSchool:      get('previousSchool'),
    secondGuardianPhone: get('secondGuardianPhone'),
    medicalNotes:        get('medicalNotes'),
    photoUrl: '',
  };
}

export function csvTemplate(): string {
  const header = CSV_COLUMNS.map((c) => c.key).join(',');
  const example = CSV_COLUMNS.map((c) => c.example).join(',');
  return `${header}\n${example}\n`;
}

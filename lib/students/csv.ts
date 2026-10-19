// CSV parsing and row mapping for bulk student import. Rows are mapped to the
// same input shape as the Register Student form and validated with
// ImportStudentRowSchema, which shares every field rule with the form.
import {
  todayInHarare,
  RELATIONSHIP_OPTIONS,
  type ImportStudentRowInput,
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

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const CSV_COLUMNS = [
  { key: 'admission_number',       field: 'admissionNumber',        required: false, example: '' },
  { key: 'first_name',             field: 'firstName',              required: true,  example: 'Tatenda' },
  { key: 'surname',                field: 'surname',                required: true,  example: 'Moyo' },
  { key: 'gender',                 field: 'gender',                 required: true,  example: 'Male' },
  { key: 'date_of_birth',          field: 'dateOfBirth',            required: true,  example: '2013-04-21' },
  { key: 'level',                  field: 'level',                  required: true,  example: 'Form 1' },
  { key: 'stream',                 field: 'stream',                 required: true,  example: 'North' },
  { key: 'guardian_name',          field: 'guardianName',           required: true,  example: 'Rudo Moyo' },
  { key: 'guardian_relationship',  field: 'guardianRelationship',   required: true,  example: 'Mother' },
  { key: 'guardian_phone',         field: 'guardianPhone',          required: true,  example: '0771234567' },
  { key: 'address',                field: 'address',                required: true,  example: '1234 Kuwadzana, Harare' },
  { key: 'admission_date',         field: 'admissionDate',          required: false, example: '' },
  { key: 'birth_certificate_number', field: 'birthCertificateNumber', required: false, example: '' },
  { key: 'previous_school',        field: 'previousSchool',         required: false, example: '' },
  { key: 'medical_notes',          field: 'medicalNotes',           required: false, example: '' },
  { key: 'guardian_alt_phone',     field: 'guardianAltPhone',       required: false, example: '' },
  { key: 'guardian_email',         field: 'guardianEmail',          required: false, example: '' },
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number]['key'];

// "First Name", "first_name" and "firstName" all map to first_name.
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const COLUMN_BY_SQUASHED = new Map<string, CsvColumn>();
for (const c of CSV_COLUMNS) {
  COLUMN_BY_SQUASHED.set(squash(c.key), c.key);
  COLUMN_BY_SQUASHED.set(squash(c.field), c.key);
}
COLUMN_BY_SQUASHED.set('dob', 'date_of_birth');
COLUMN_BY_SQUASHED.set('lastname', 'surname');
COLUMN_BY_SQUASHED.set('sex', 'gender');
COLUMN_BY_SQUASHED.set('form', 'level');
COLUMN_BY_SQUASHED.set('grade', 'level');
COLUMN_BY_SQUASHED.set('studentid', 'admission_number');

export function mapHeaders(headers: string[]): { index: Partial<Record<CsvColumn, number>>; missing: CsvColumn[] } {
  const index: Partial<Record<CsvColumn, number>> = {};
  headers.forEach((h, i) => {
    const key = COLUMN_BY_SQUASHED.get(squash(h));
    if (key && index[key] === undefined) index[key] = i;
  });
  const missing = CSV_COLUMNS.filter((c) => c.required && index[c.key] === undefined).map((c) => c.key);
  return { index, missing };
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

const RELATIONSHIP_ALIASES: Record<string, string> = {
  grandfather: 'GRANDPARENT', grandmother: 'GRANDPARENT', granny: 'GRANDPARENT', gogo: 'GRANDPARENT', sekuru: 'GRANDPARENT',
  brother: 'SIBLING', sister: 'SIBLING', dad: 'FATHER', mum: 'MOTHER', mom: 'MOTHER',
};

export function csvRowToInput(fields: string[], index: Partial<Record<CsvColumn, number>>): ImportStudentRowInput {
  const get = (key: CsvColumn) => {
    const i = index[key];
    return i === undefined ? '' : (fields[i] ?? '').trim();
  };

  const genderRaw = get('gender').toLowerCase();
  const gender = genderRaw === 'm' || genderRaw === 'male' ? 'M'
    : genderRaw === 'f' || genderRaw === 'female' ? 'F'
    : get('gender');

  // Anything not in the list is kept as an "Other" relationship with its text.
  const relRaw = get('guardian_relationship');
  const rel = RELATIONSHIP_OPTIONS.find((r) => r.label.toLowerCase() === relRaw.toLowerCase() || r.value === relRaw.toUpperCase())?.value
    ?? RELATIONSHIP_ALIASES[relRaw.toLowerCase()];

  const dob = get('date_of_birth');
  const admitted = get('admission_date');

  return {
    admissionNumber: get('admission_number'),
    firstName:   get('first_name'),
    surname:     get('surname'),
    gender:      gender as ImportStudentRowInput['gender'],
    dateOfBirth: dob ? csvDateToIso(dob) : '',
    level:       get('level'),
    stream:      get('stream'),
    admissionDate: admitted ? csvDateToIso(admitted) : todayInHarare(),
    guardianName: get('guardian_name'),
    guardianRelationship: (rel ?? (relRaw ? 'OTHER' : '')) as ImportStudentRowInput['guardianRelationship'],
    guardianRelationshipOther: rel ? '' : relRaw,
    guardianPhone: get('guardian_phone'),
    guardianAltPhone: get('guardian_alt_phone'),
    guardianEmail: get('guardian_email'),
    guardianNationalId: '',
    guardianOccupation: '',
    address: get('address'),
    birthCertificateNumber: get('birth_certificate_number'),
    previousSchool: get('previous_school'),
    medicalNotes: get('medical_notes'),
  };
}

export function csvTemplate(): string {
  return toCsv([CSV_COLUMNS.map((c) => c.key), CSV_COLUMNS.map((c) => c.example)]);
}

export interface RejectedRow {
  row: number;
  name: string;
  messages: string[];
}

// The downloadable "rejected rows" report.
export function rejectionReportCsv(rows: RejectedRow[]): string {
  return toCsv([['row', 'student', 'reason'], ...rows.map((r) => [r.row, r.name, r.messages.join('; ')])]);
}

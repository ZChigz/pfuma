import { describe, expect, it } from 'vitest';
import {
  ageOn,
  ageWarning,
  currentYearInHarare,
  defaultRegistrationValues,
  formatStudentNumber,
  normalizeName,
  normalizeZimMobile,
  RegisterStudentSchema,
  todayInHarare,
  type RegisterStudentInput,
} from '@/lib/students/registration';
import { csvDateToIso, csvRowToInput, mapHeaders, parseCsv } from '@/lib/students/csv';

function validInput(overrides: Partial<RegisterStudentInput> = {}): RegisterStudentInput {
  const year = currentYearInHarare();
  return {
    ...defaultRegistrationValues(),
    firstName: '  tatenda ',
    surname: 'MOYO',
    gender: 'M',
    dateOfBirth: `${year - 13}-03-05`,
    form: 'Form 1',
    stream: 'North',
    guardianName: 'rudo   moyo',
    guardianRelationship: 'Mother',
    guardianPhone: '077 123 4567',
    houseNumber: '1234a',
    suburb: 'Kuwadzana',
    ...overrides,
  };
}

function errorsFor(input: RegisterStudentInput): Record<string, string> {
  const r = RegisterStudentSchema.safeParse(input);
  if (r.success) return {};
  return Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
}

describe('normalizeName', () => {
  it('trims, collapses spaces and capitalises', () => {
    expect(normalizeName('  tatenda   moyo ')).toBe('Tatenda Moyo');
    expect(normalizeName('TATENDA')).toBe('Tatenda');
    expect(normalizeName("o'brien mary-jane")).toBe("O'Brien Mary-Jane");
  });
  it('keeps deliberate mixed case', () => {
    expect(normalizeName('McDonald')).toBe('McDonald');
  });
});

describe('normalizeZimMobile', () => {
  it.each([
    ['0771234567', '+263771234567'],
    ['078 123 4567', '+263781234567'],
    ['071-123-4567', '+263711234567'],
    ['0731234567', '+263731234567'],
    ['+263 77 123 4567', '+263771234567'],
    ['263771234567', '+263771234567'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeZimMobile(raw)).toBe(expected);
  });
  it.each(['0242123456', '0791234567', '077123456', '07712345678', '+27821234567', 'abc'])(
    'rejects %s', (raw) => {
      expect(normalizeZimMobile(raw)).toBeNull();
    },
  );
});

describe('age rules', () => {
  it('computes whole years', () => {
    expect(ageOn('2012-06-15', '2026-06-14')).toBe(13);
    expect(ageOn('2012-06-15', '2026-06-15')).toBe(14);
  });
  it('warns outside the form range only', () => {
    expect(ageWarning('2012-01-01', 'Form 1', '2026-02-01')).toBeNull();      // 14
    expect(ageWarning('2016-01-01', 'Form 1', '2026-02-01')).toMatch(/10 years old/);
    expect(ageWarning('2008-01-01', 'Form 4', '2026-02-01')).toMatch(/18 years old/);
  });
});

describe('formatStudentNumber', () => {
  it('pads the sequence to 4 digits', () => {
    expect(formatStudentNumber(2026, 1)).toBe('STU20260001');
    expect(formatStudentNumber(2026, 1234)).toBe('STU20261234');
  });
});

describe('RegisterStudentSchema', () => {
  it('cleans and combines valid input', () => {
    const r = RegisterStudentSchema.parse(validInput());
    expect(r.firstName).toBe('Tatenda');
    expect(r.surname).toBe('Moyo');
    expect(r.fullName).toBe('Tatenda Moyo');
    expect(r.className).toBe('Form 1 North');
    expect(r.guardianName).toBe('Rudo Moyo');
    expect(r.guardianPhone).toBe('+263771234567');
    expect(r.address).toBe('1234A, Kuwadzana, Harare');
    expect(r.enrollmentYear).toBe(currentYearInHarare());
    expect(r.status).toBe('ACTIVE');
    expect(r.medicalNotes).toBeNull();
  });

  it('rejects bad names with plain messages', () => {
    expect(errorsFor(validInput({ firstName: 'T' })).firstName).toMatch(/at least 2/);
    expect(errorsFor(validInput({ surname: 'Moyo2' })).surname).toMatch(/only contain letters/);
    expect(errorsFor(validInput({ firstName: '' })).firstName).toBe('First name is required');
  });

  it('requires the guardian first name and surname', () => {
    expect(errorsFor(validInput({ guardianName: 'Moyo' })).guardianName).toMatch(/first name and surname/);
  });

  it('rejects future dates of birth and enrollment years', () => {
    const tomorrowYear = currentYearInHarare() + 1;
    expect(errorsFor(validInput({ dateOfBirth: `${tomorrowYear}-01-01` })).dateOfBirth).toMatch(/future/);
    expect(errorsFor(validInput({ dateOfBirth: '2013-02-30' })).dateOfBirth).toMatch(/real date/);
    expect(errorsFor(validInput({ enrollmentYear: String(tomorrowYear) })).enrollmentYear).toMatch(/future/);
    expect(todayInHarare()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects invalid phone numbers', () => {
    expect(errorsFor(validInput({ guardianPhone: '0242123456' })).guardianPhone).toMatch(/Zimbabwean mobile/);
    expect(errorsFor(validInput({ secondGuardianPhone: '0771234567' })).secondGuardianPhone).toMatch(/same as/);
  });

  it('needs the text box when Other is chosen', () => {
    expect(errorsFor(validInput({ guardianRelationship: 'Other' })).guardianRelationshipOther).toBeDefined();
    expect(errorsFor(validInput({ suburb: 'Other' })).suburbOther).toBeDefined();
    const r = RegisterStudentSchema.parse(validInput({
      guardianRelationship: 'Other', guardianRelationshipOther: 'step father',
      suburb: 'Other', suburbOther: 'cold comfort',
    }));
    expect(r.guardianRelationship).toBe('Step Father');
    expect(r.suburb).toBe('Cold Comfort');
  });

  it('requires dropdown choices', () => {
    const e = errorsFor(validInput({ gender: '' as never, form: '' as never, stream: '' as never }));
    expect(e.gender).toMatch(/Male or Female/);
    expect(e.form).toMatch(/form/);
    expect(e.stream).toMatch(/stream/);
  });
});

describe('CSV import mapping', () => {
  it('parses quoted fields with commas and newlines', () => {
    const rows = parseCsv('a,b\n"x, y","line1\nline2"\r\n\n');
    expect(rows).toEqual([['a', 'b'], ['x, y', 'line1\nline2']]);
  });

  it('maps flexible headers and values to form input', () => {
    const [header, row] = parseCsv(
      'First Name,surname,sex,dob,form,stream,guardian_name,guardianRelationship,guardianPhone,houseNumber,suburb\n'
      + `tatenda,moyo,male,05/03/${currentYearInHarare() - 13},2,east,Rudo Moyo,step mother,0771234567,12,Hopley`,
    );
    const { index, missing } = mapHeaders(header);
    expect(missing).toEqual([]);
    const input = csvRowToInput(row, index);
    expect(input.gender).toBe('M');
    expect(input.form).toBe('Form 2');
    expect(input.stream).toBe('East');
    expect(input.guardianRelationship).toBe('Other');
    expect(input.guardianRelationshipOther).toBe('step mother');
    expect(input.suburb).toBe('Hopley');
    expect(input.city).toBe('Harare');
    expect(RegisterStudentSchema.safeParse(input).success).toBe(true);
  });

  it('reports missing required columns', () => {
    expect(mapHeaders(['firstName', 'surname']).missing).toContain('guardianPhone');
  });

  it('converts DD/MM/YYYY dates', () => {
    expect(csvDateToIso('5/3/2013')).toBe('2013-03-05');
    expect(csvDateToIso('2013/3/5')).toBe('2013-03-05');
  });
});

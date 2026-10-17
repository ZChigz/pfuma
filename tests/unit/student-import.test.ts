import { describe, expect, it } from 'vitest';
import { applyMapping, autoMap, importTemplateCsv, splitClassName } from '@/lib/students/import-map';
import { checkRowFields } from '@/lib/students/import';
import { parseCsv } from '@/lib/students/csv';

const TODAY = '2026-10-17';

describe('matching the headings of a file', () => {
  it('knows the template columns', () => {
    const headings = parseCsv(importTemplateCsv())[0]!;
    expect(headings).toEqual([
      'first_name', 'surname', 'gender', 'date_of_birth', 'birth_certificate_no', 'form', 'stream', 'boarding', 'admission_date',
      'guardian_name', 'guardian_relationship', 'guardian_phone', 'guardian_phone_2', 'address',
    ]);
    const m = autoMap(headings);
    expect(m.missing).toEqual([]);
    expect(m.unmatched).toEqual([]);
  });

  it("matches the 500-student test file's headings, including class_name and student_id", () => {
    const m = autoMap(['student_id', 'first_name', 'surname', 'gender', 'date_of_birth', 'form', 'stream', 'class_name', 'enrollment_year', 'guardian_name', 'guardian_relationship', 'guardian_phone', 'address', 'status']);
    expect(m.mapping).toMatchObject({ admission_number: 0, first_name: 1, surname: 2, gender: 3, date_of_birth: 4, form: 5, stream: 6, class_name: 7, guardian_name: 9, guardian_relationship: 10, guardian_phone: 11, address: 12 });
    expect(m.unmatched.map((u) => u.heading)).toEqual(['enrollment_year', 'status']);
    expect(m.missing).toEqual([]);
  });

  it('matches other schools\' headings however they are written, using each file column once', () => {
    const m = autoMap(['First Name', 'Last Name', 'Sex', 'DOB', 'Birth Cert No.', 'Grade', 'Section', 'Parent Name', 'Relationship', 'Parent Phone', 'Alt Phone', 'Residential Address']);
    expect(m.mapping).toMatchObject({ first_name: 0, surname: 1, gender: 2, date_of_birth: 3, birth_certificate_no: 4, form: 5, stream: 6, guardian_name: 7, guardian_relationship: 8, guardian_phone: 9, guardian_phone_2: 10, address: 11 });
    expect(Object.values(m.mapping).filter((v) => v !== null)).toHaveLength(new Set(Object.values(m.mapping).filter((v) => v !== null)).size);
  });

  it('reports the required columns it could not find, and the file columns nothing matched', () => {
    const m = autoMap(['Name', 'Birthday', 'Colour']);
    expect(m.missing).toEqual(expect.arrayContaining(['first_name', 'surname', 'gender', 'date_of_birth', 'guardian_phone']));
    expect(m.unmatched.map((u) => u.heading)).toEqual(['Name', 'Birthday', 'Colour']);
  });

  it('turns rows into template rows with the mapping the admin chose', () => {
    const rows = [['Given', 'Family', 'Z'], ['Tatenda', 'Moyo', 'x'], ['Rufaro', 'Dube', 'y']];
    const out = applyMapping(rows, { ...autoMap([]).mapping, first_name: 0, surname: 1 });
    expect(out).toEqual([{ rowNumber: 2, values: { first_name: 'Tatenda', surname: 'Moyo' } }, { rowNumber: 3, values: { first_name: 'Rufaro', surname: 'Dube' } }]);
  });

  it('splits a class name into form and stream', () => {
    expect(splitClassName('Form 2 East')).toEqual({ form: '2', stream: 'East' });
    expect(splitClassName('3 North')).toEqual({ form: '3', stream: 'North' });
    expect(splitClassName('Form 6')).toEqual({ form: '6', stream: '' });
    expect(splitClassName('Reception')).toBeNull();
  });
});

const good = {
  first_name: 'tatenda', surname: 'moyo', gender: 'Male', date_of_birth: '2013-04-21', form: '1', stream: 'north', guardian_name: 'rudo moyo',
  guardian_relationship: 'Mother', guardian_phone: '0771234567',
};

describe('checking one row', () => {
  it('cleans a good row', () => {
    const r = checkRowFields(good, TODAY);
    expect(r.errors).toEqual([]);
    expect(r.clean).toMatchObject({
      firstName: 'Tatenda', surname: 'Moyo', gender: 'M', dateOfBirth: '2013-04-21', level: 'Form 1', stream: 'North', className: 'Form 1 North', boarding: 'DAY',
      admissionDate: TODAY, guardianName: 'Rudo Moyo', relationship: 'MOTHER', guardianPhone: '+263771234567', guardianPhone2: null, birthCertificateNumber: null,
    });
  });

  it('accepts the usual ways of writing things', () => {
    const r = checkRowFields({
      ...good, gender: 'f', date_of_birth: '21/04/2013', form: 'Form 3', boarding: 'Boarder', admission_date: '12/01/2026', birth_certificate_no: '63-123456 a 42',
      guardian_relationship: 'Gogo', guardian_phone: '+263 77 123 4567', guardian_phone_2: '0712345678', address: '12 Mbare, Harare',
    }, TODAY);
    expect(r.errors).toEqual([]);
    expect(r.clean).toMatchObject({ gender: 'F', dateOfBirth: '2013-04-21', level: 'Form 3', boarding: 'BOARDER', admissionDate: '2026-01-12', birthCertificateNumber: '63123456A42', relationship: 'GRANDPARENT', guardianPhone: '+263771234567', guardianPhone2: '+263712345678', address: '12 Mbare, Harare' });
  });

  it('reads form and stream from the class column when they are missing', () => {
    const r = checkRowFields({ ...good, form: '', stream: '', class_name: 'Form 4 East' }, TODAY);
    expect(r.clean).toMatchObject({ level: 'Form 4', stream: 'East', className: 'Form 4 East' });
  });

  it('keeps an unusual relationship as Other with its words', () => {
    const r = checkRowFields({ ...good, guardian_relationship: 'Family friend' }, TODAY);
    expect(r.clean).toMatchObject({ relationship: 'OTHER', relationshipNote: 'Family friend' });
  });

  it('explains each thing that is wrong, naming the column', () => {
    const r = checkRowFields({ first_name: 'T', surname: '123', gender: 'maybe', date_of_birth: '2013-02-30', form: '9', stream: '', boarding: 'sometimes', guardian_name: 'Madonna', guardian_relationship: '', guardian_phone: '12345', birth_certificate_no: 'abc' }, TODAY);
    expect(r.clean).toBeNull();
    const text = r.errors.join('\n');
    for (const label of ['First name', 'Surname', 'Gender', 'Date of birth', 'Form', 'Stream', 'Boarding', 'Guardian name', 'Guardian relationship', 'Guardian phone', 'Birth certificate number']) expect(text, label).toContain(label);
  });

  it('refuses a date of birth in the future, an admission before birth, and a bad admission number', () => {
    expect(checkRowFields({ ...good, date_of_birth: '2027-01-01' }, TODAY).errors.join()).toContain('future');
    expect(checkRowFields({ ...good, admission_date: '2012-01-01' }, TODAY).errors.join()).toContain('before the date of birth');
    expect(checkRowFields({ ...good, admission_number: 'a b!' }, TODAY).errors.join()).toContain('Admission number');
    expect(checkRowFields({ ...good, admission_number: 'STU20260001' }, TODAY).clean?.admissionNumber).toBe('STU20260001');
  });

  it('warns about an age outside the usual range without rejecting the row', () => {
    const r = checkRowFields({ ...good, date_of_birth: '2005-01-01' }, TODAY);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toContain('years old');
    expect(r.clean).not.toBeNull();
  });
});

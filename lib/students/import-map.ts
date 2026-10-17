// CSV import, step 2: matching the file's column headings to the template columns. Pure functions, so the
// browser (for the mapping screen) and the server (for the check) agree. Headings like "Student ID",
// "class_name" or "Parent Phone" are matched automatically; the admin fixes whatever is left.

export const IMPORT_FIELDS = [
  { key: 'first_name', label: 'First name(s)', required: true, example: 'Tatenda', synonyms: ['firstname', 'firstnames', 'givenname', 'givennames', 'forename'] },
  { key: 'surname', label: 'Surname', required: true, example: 'Moyo', synonyms: ['lastname', 'familyname', 'secondname'] },
  { key: 'gender', label: 'Gender', required: true, example: 'Male', synonyms: ['sex'] },
  { key: 'date_of_birth', label: 'Date of birth', required: true, example: '2013-04-21', synonyms: ['dob', 'birthdate', 'dateofbirth', 'born'] },
  { key: 'birth_certificate_no', label: 'Birth certificate number', required: false, example: '63-123456 A 42', synonyms: ['birthcertificatenumber', 'birthcertno', 'birthcert', 'birthcertificate', 'bcno'] },
  { key: 'form', label: 'Form', required: true, example: '1', synonyms: ['level', 'grade', 'classlevel'] },
  { key: 'stream', label: 'Stream', required: true, example: 'North', synonyms: ['section', 'house stream'] },
  { key: 'boarding', label: 'Day scholar or boarder', required: false, example: 'Day', synonyms: ['residence', 'dayboarder', 'boardingstatus', 'daystatus'] },
  { key: 'admission_date', label: 'Admission date', required: false, example: '2026-01-12', synonyms: ['dateadmitted', 'admitted', 'enrollmentdate', 'enrolmentdate', 'dateofadmission'] },
  { key: 'guardian_name', label: 'Guardian name', required: true, example: 'Rudo Moyo', synonyms: ['parentname', 'guardian', 'parent', 'nextofkin', 'nextofkinname'] },
  { key: 'guardian_relationship', label: 'Guardian relationship', required: true, example: 'Mother', synonyms: ['relationship', 'relation', 'parentrelationship'] },
  { key: 'guardian_phone', label: 'Guardian phone', required: true, example: '0771234567', synonyms: ['parentphone', 'phone', 'contactphone', 'guardiancontact', 'guardianmobile', 'mobile', 'cell'] },
  { key: 'guardian_phone_2', label: 'Guardian second phone', required: false, example: '', synonyms: ['guardianaltphone', 'secondphone', 'altphone', 'phone2', 'alternativephone', 'guardianphone2'] },
  { key: 'address', label: 'Address', required: false, example: '1234 Kuwadzana, Harare', synonyms: ['residentialaddress', 'homeaddress', 'residence address'] },
  // Optional extras: other systems' files usually have them.
  { key: 'admission_number', label: 'Admission number', required: false, example: '', synonyms: ['studentid', 'admissionno', 'admno', 'regnumber', 'registrationnumber', 'studentnumber', 'studentno'] },
  { key: 'class_name', label: 'Class (e.g. Form 2 East)', required: false, example: '', synonyms: ['class', 'classname', 'homeclass'] },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]['key'];
export type ImportRow = Partial<Record<ImportFieldKey, string>>;

/** "First Name", "first_name" and "firstName" all squash to "firstname". */
export const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface ColumnMapping {
  /** For each template column, the index of the file column that feeds it, or null. */
  mapping: Record<ImportFieldKey, number | null>;
  /** File columns that matched nothing; shown so the admin can pick one for a gap or leave it out. */
  unmatched: { index: number; heading: string }[];
  /** Required template columns that still have no file column. */
  missing: ImportFieldKey[];
}

/** Matches headings to the template: exact names first, then known alternatives. Each file column is used once. */
export function autoMap(headings: string[]): ColumnMapping {
  const mapping = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, null])) as Record<ImportFieldKey, number | null>;
  const used = new Set<number>();
  const squashed = headings.map(squash);
  const take = (key: ImportFieldKey, wanted: string[]) => {
    if (mapping[key] !== null) return;
    for (const w of wanted) {
      const i = squashed.findIndex((h, idx) => h === w && !used.has(idx));
      if (i >= 0) { mapping[key] = i; used.add(i); return; }
    }
  };
  for (const f of IMPORT_FIELDS) take(f.key, [squash(f.key)]);
  for (const f of IMPORT_FIELDS) take(f.key, [squash(f.label), ...f.synonyms.map(squash)]);
  return {
    mapping,
    unmatched: headings.flatMap((heading, index) => (used.has(index) ? [] : [{ index, heading }])),
    missing: IMPORT_FIELDS.filter((f) => f.required && mapping[f.key] === null).map((f) => f.key),
  };
}

/** The file's rows turned into template rows using the chosen mapping. The first row of `rows` is the heading row. */
export function applyMapping(rows: string[][], mapping: Record<ImportFieldKey, number | null>): { rowNumber: number; values: ImportRow }[] {
  return rows.slice(1).map((cells, i) => {
    const values: ImportRow = {};
    for (const f of IMPORT_FIELDS) {
      const idx = mapping[f.key];
      if (idx !== null && idx !== undefined) values[f.key] = (cells[idx] ?? '').trim();
    }
    return { rowNumber: i + 2, values };
  });
}

/** The class column can feed form and stream: "Form 2 East" → form 2, stream East. */
export function splitClassName(raw: string): { form: string; stream: string } | null {
  const m = /^\s*(?:form\s*)?([1-6])\s*(.*)$/i.exec(raw);
  return m ? { form: m[1]!, stream: (m[2] ?? '').trim() } : null;
}

export function importTemplateCsv(): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const fields = IMPORT_FIELDS.filter((f) => !['admission_number', 'class_name'].includes(f.key));
  return [fields.map((f) => f.key), fields.map((f) => f.example)].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

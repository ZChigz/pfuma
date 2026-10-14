// Builds the demo-data migration from prisma/demo-data/high_school_students.csv
// and prisma/demo-data/populate.sql.
//
//   node scripts/generate-demo-data.mjs
//
// Every CSV row is checked first (admission number, gender, date, Form 1–6,
// class name, relationship, phone, status); the script stops on the first bad row.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV = join(root, 'prisma/demo-data/high_school_students.csv');
const TEMPLATE = join(root, 'prisma/demo-data/populate.sql');
const OUT = join(root, 'prisma/migrations/20261016010000_demo_data/migration.sql');

const RELATIONSHIPS = {
  father: 'FATHER',
  mother: 'MOTHER',
  uncle: 'UNCLE',
  aunt: 'AUNT',
  grandmother: 'GRANDPARENT',
  grandfather: 'GRANDPARENT',
  grandparent: 'GRANDPARENT',
  brother: 'SIBLING',
  sister: 'SIBLING',
  sibling: 'SIBLING',
  guardian: 'GUARDIAN',
};
const STATUSES = { active: 'ACTIVE', suspended: 'SUSPENDED', transferred: 'TRANSFERRED', graduated: 'GRADUATED', withdrawn: 'WITHDRAWN' };

// Splits one CSV line, honouring double-quoted fields.
function parseLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const sql = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const lines = readFileSync(CSV, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '');
const header = parseLine(lines[0]);
const col = (name) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`CSV is missing the "${name}" column`);
  return i;
};

const seen = new Set();
const rows = lines.slice(1).map((line, n) => {
  const f = parseLine(line);
  const at = `CSV line ${n + 2}`;
  const get = (name) => f[col(name)];
  const fail = (msg) => { throw new Error(`${at}: ${msg}`); };

  const adm = get('student_id');
  if (!/^STU\d{8}$/.test(adm)) fail(`student_id "${adm}" is not STU + year + 4 digits`);
  if (seen.has(adm)) fail(`duplicate student_id ${adm}`);
  seen.add(adm);

  const gender = get('gender').toUpperCase();
  if (gender !== 'M' && gender !== 'F') fail(`gender "${get('gender')}" must be M or F`);

  const dob = get('date_of_birth');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(dob))) fail(`date_of_birth "${dob}" is not YYYY-MM-DD`);

  const form = Number(get('form'));
  if (!Number.isInteger(form) || form < 1 || form > 6) fail(`form "${get('form')}" must be 1–6`);

  const stream = get('stream');
  const className = get('class_name');
  if (className !== `Form ${form} ${stream}`) fail(`class_name "${className}" does not match form ${form} and stream ${stream}`);

  const year = Number(get('enrollment_year'));
  if (!Number.isInteger(year) || year < 2000 || year > 2026) fail(`enrollment_year "${get('enrollment_year')}" is not a year up to 2026`);

  const relRaw = get('guardian_relationship');
  const relationship = RELATIONSHIPS[relRaw.toLowerCase()] ?? 'OTHER';
  const relationshipNote = relationship === 'OTHER' ? relRaw : null;

  const phone = get('guardian_phone');
  if (!/^\+263\d{9}$/.test(phone)) fail(`guardian_phone "${phone}" is not +263 followed by 9 digits`);

  const status = STATUSES[get('status').toLowerCase()];
  if (!status) fail(`status "${get('status')}" is not one of ${Object.keys(STATUSES).join(', ')}`);

  // "521 Mbare, Harare" → house 521, suburb Mbare, city Harare.
  const address = get('address');
  const m = address.match(/^(\S+)\s+([^,]+),\s*(.+)$/);

  return [
    adm, get('first_name'), get('surname'), gender, dob, form, stream, className, year,
    get('guardian_name'), relationship, relationshipNote, phone,
    m?.[1] ?? null, m?.[2]?.trim() ?? null, m?.[3]?.trim() ?? null, address, status,
  ];
});

const values = rows
  .map((r) => `  (${r.map((v) => (typeof v === 'number' ? String(v) : sql(v))).join(', ')})`)
  .join(',\n');
const insert =
  'INSERT INTO demo_csv (adm, first_name, surname, gender, dob, form, stream, class_name, enrollment_year,\n' +
  '                      guardian_name, relationship, relationship_note, guardian_phone, house_number, suburb, city, address, status)\nVALUES\n' +
  values + ';';

const template = readFileSync(TEMPLATE, 'utf8');
if (!template.includes('-- @@STUDENTS@@')) throw new Error('populate.sql is missing the -- @@STUDENTS@@ marker');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, template.replace('-- @@STUDENTS@@', insert));
console.log(`Wrote ${rows.length} students to ${OUT}`);

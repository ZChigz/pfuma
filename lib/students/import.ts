// CSV import, steps 3 and 4: checking every row (OK, Warning or Error with the reason) and importing the valid
// rows in one transaction. The check is run again on the server at import time, so a row that was fine in the
// preview but is no longer (someone else added the same child meanwhile) is skipped, not saved twice.
//  • Error rows are skipped and listed in a downloadable report; OK and Warning rows are imported.
//  • Guardians with the same phone number are merged into one record, in the file and with those already in the school.
//  • A student without an admission number gets the next one from the school's format.
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import type { AccessUser } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { dateOnly } from '@/lib/academic/terms';
import { classDisplayName, normalizeStream, parseLevelOrder } from '@/lib/academic/rules';
import { toCsv } from '@/lib/csv';
import { csvDateToIso } from '@/lib/students/csv';
import { splitClassName, type ImportRow } from '@/lib/students/import-map';
import {
  ageWarning, isRealIsoDate, MIN_ADMISSION_DATE, mobilePhone, normalizeName, personName, RELATIONSHIPS, todayInHarare, type LevelName,
} from '@/lib/students/registration';
import { isValidBirthCert, normaliseBirthCert } from '@/lib/students/rules';
import { nextSequences, takeAdmissionNumber, withAdmissionNumberRetry } from '@/lib/students/server';

export const MAX_IMPORT_ROWS = 1500;

export type RowStatus = 'OK' | 'WARNING' | 'ERROR';

export interface CheckedRow {
  /** The row's line in the file (the heading row is line 1). */
  rowNumber: number;
  status: RowStatus;
  /** Why the row is a Warning or an Error. */
  messages: string[];
  /** Short label for the report. */
  name: string;
  /** The cleaned values, only for rows that can be imported. */
  clean: CleanRow | null;
}

export interface CleanRow {
  admissionNumber: string | null;
  firstName: string;
  surname: string;
  gender: 'M' | 'F';
  dateOfBirth: string;
  birthCertificateNumber: string | null;
  level: LevelName;
  stream: string;
  className: string;
  boarding: 'DAY' | 'BOARDER';
  admissionDate: string;
  guardianName: string;
  relationship: (typeof RELATIONSHIPS)[number];
  relationshipNote: string | null;
  guardianPhone: string;
  guardianPhone2: string | null;
  address: string | null;
}

const ALIASES: Record<string, (typeof RELATIONSHIPS)[number]> = {
  father: 'FATHER', dad: 'FATHER', baba: 'FATHER', mother: 'MOTHER', mum: 'MOTHER', mom: 'MOTHER', mai: 'MOTHER', amai: 'MOTHER',
  uncle: 'UNCLE', babamukuru: 'UNCLE', babawokunyana: 'UNCLE', aunt: 'AUNT', auntie: 'AUNT', tete: 'AUNT', ambuya: 'GRANDPARENT', sekuru: 'GRANDPARENT',
  grandfather: 'GRANDPARENT', grandmother: 'GRANDPARENT', grandparent: 'GRANDPARENT', gogo: 'GRANDPARENT', granny: 'GRANDPARENT',
  brother: 'SIBLING', sister: 'SIBLING', sibling: 'SIBLING', guardian: 'GUARDIAN', other: 'OTHER',
};

const cleanText = (v: string | undefined) => (v ?? '').trim().replace(/\s+/g, ' ');

/** One row's own rules: nothing is looked up here. Returns the clean row or the reasons it cannot be used. */
export function checkRowFields(raw: ImportRow, today = todayInHarare()): { clean: CleanRow | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const need = (label: string, ok: boolean, message: string) => { if (!ok) errors.push(`${label}: ${message}`); };

  const first = personName('First name').safeParse(cleanText(raw.first_name));
  need('First name', first.success, first.success ? '' : first.error.issues[0]!.message);
  const last = personName('Surname').safeParse(cleanText(raw.surname));
  need('Surname', last.success, last.success ? '' : last.error.issues[0]!.message);

  const g = cleanText(raw.gender).toLowerCase();
  const gender = g === 'm' || g === 'male' || g === 'boy' ? 'M' : g === 'f' || g === 'female' || g === 'girl' ? 'F' : null;
  need('Gender', !!gender, 'use Male or Female');

  const dob = csvDateToIso(cleanText(raw.date_of_birth));
  need('Date of birth', isRealIsoDate(dob) && dob <= today, isRealIsoDate(dob) ? 'cannot be in the future' : 'enter a real date such as 2013-04-21');

  let certificate: string | null = null;
  if (cleanText(raw.birth_certificate_no)) {
    if (isValidBirthCert(raw.birth_certificate_no!)) certificate = normaliseBirthCert(raw.birth_certificate_no!);
    else errors.push('Birth certificate number: should look like 63-123456 A 42');
  }

  // Form and stream come from their own columns, or from the class column ("Form 2 East").
  let formRaw = cleanText(raw.form);
  let streamRaw = cleanText(raw.stream);
  if ((!formRaw || !streamRaw) && raw.class_name) {
    const split = splitClassName(raw.class_name);
    if (split) { formRaw ||= split.form; streamRaw ||= split.stream; }
  }
  const order = parseLevelOrder(/^\d$/.test(formRaw) ? `Form ${formRaw}` : formRaw);
  need('Form', !!order, 'use Form 1 to Form 6');
  const stream = normalizeStream(streamRaw);
  need('Stream', !!stream && stream.length <= 30, 'give the stream, such as North');

  const b = cleanText(raw.boarding).toLowerCase();
  const boarding: 'DAY' | 'BOARDER' | null = !b || /^(day|day ?scholar|d)$/.test(b) ? 'DAY' : /^(board|boarder|boarding|b)$/.test(b) ? 'BOARDER' : null;
  need('Boarding', !!boarding, 'use Day or Boarder');

  let admissionDate = today;
  if (cleanText(raw.admission_date)) {
    admissionDate = csvDateToIso(cleanText(raw.admission_date));
    need('Admission date', isRealIsoDate(admissionDate) && admissionDate <= today && admissionDate >= MIN_ADMISSION_DATE, 'enter a real date that is not in the future');
  }
  if (isRealIsoDate(dob) && isRealIsoDate(admissionDate) && admissionDate < dob) errors.push('Admission date: cannot be before the date of birth');

  const gName = personName('Guardian name').safeParse(cleanText(raw.guardian_name));
  need('Guardian name', gName.success && gName.data.includes(' '), gName.success ? "enter the guardian's first name and surname" : gName.error.issues[0]!.message);
  const relRaw = cleanText(raw.guardian_relationship);
  const rel = ALIASES[relRaw.toLowerCase().replace(/[^a-z]/g, '')];
  const relationship = rel ?? (relRaw ? 'OTHER' : null);
  need('Guardian relationship', !!relationship, 'say how the guardian is related');
  const phone = mobilePhone('Phone', true).safeParse(raw.guardian_phone);
  need('Guardian phone', phone.success, phone.success ? '' : 'enter a Zimbabwean mobile number such as 0771234567');
  const phone2 = mobilePhone('Phone', false).safeParse(raw.guardian_phone_2);
  need('Guardian second phone', phone2.success, 'enter a Zimbabwean mobile number such as 0771234567');
  const addr = cleanText(raw.address);

  const admissionNumber = cleanText(raw.admission_number);
  if (admissionNumber && !/^[A-Za-z0-9/_-]{3,30}$/.test(admissionNumber)) errors.push('Admission number: use letters, numbers, - and / (3 to 30 characters)');

  if (errors.length || !first.success || !last.success || !gender || !order || !boarding || !gName.success || !relationship || !phone.success || !phone2.success) {
    return { clean: null, errors, warnings };
  }
  const level = `Form ${order}` as LevelName;
  const note = ageWarning(dob, level, today);
  if (note) warnings.push(note);
  return {
    errors, warnings,
    clean: {
      admissionNumber: admissionNumber || null, firstName: normalizeName(first.data), surname: normalizeName(last.data), gender, dateOfBirth: dob,
      birthCertificateNumber: certificate, level, stream, className: classDisplayName(level, stream), boarding, admissionDate,
      guardianName: gName.data, relationship, relationshipNote: rel ? null : relRaw.slice(0, 30), guardianPhone: phone.data!, guardianPhone2: phone2.data ?? null, address: addr || null,
    },
  };
}

const nameKey = (r: Pick<CleanRow, 'firstName' | 'surname' | 'dateOfBirth'>) => `${r.firstName}|${r.surname}|${r.dateOfBirth}`.toLowerCase();

/** Checks all rows against the file itself and against the school's students, classes and open term. */
export async function checkImportRows(user: AccessUser, rows: { rowNumber: number; values: ImportRow }[], db?: Db): Promise<CheckedRow[]> {
  if (rows.length === 0) throw new ServiceError('The file has no students', 422);
  if (rows.length > MAX_IMPORT_ROWS) throw new ServiceError(`The file has ${rows.length} students. Please split it into files of ${MAX_IMPORT_ROWS} or fewer.`, 422);
  const run = async (d: Db) => {
    const { schoolId } = user;
    const today = todayInHarare();
    const checked: CheckedRow[] = rows.map((r) => {
      const { clean, errors, warnings } = checkRowFields(r.values, today);
      const name = `${cleanText(r.values.first_name)} ${cleanText(r.values.surname)}`.trim() || '(no name)';
      return { rowNumber: r.rowNumber, name, clean, status: errors.length ? 'ERROR' : warnings.length ? 'WARNING' : 'OK', messages: [...errors, ...warnings] };
    });
    const live = checked.filter((c) => c.clean);

    // Against the school's data.
    const certs = live.flatMap((c) => (c.clean!.birthCertificateNumber ? [c.clean!.birthCertificateNumber] : []));
    const numbers = live.flatMap((c) => (c.clean!.admissionNumber ? [c.clean!.admissionNumber] : []));
    const dobs = Array.from(new Set(live.map((c) => c.clean!.dateOfBirth)));
    const [certOwners, numberOwners, sameDob, levels, classes, term, school] = await Promise.all([
      certs.length ? d.student.findMany({ where: { schoolId, birthCertificateNumber: { in: certs } }, select: { birthCertificateNumber: true, fullName: true, admissionNumber: true } }) : [],
      numbers.length ? d.student.findMany({ where: { schoolId, admissionNumber: { in: numbers } }, select: { admissionNumber: true, fullName: true } }) : [],
      dobs.length ? d.student.findMany({ where: { schoolId, dateOfBirth: { in: dobs.map(dateOnly) } }, select: { firstName: true, surname: true, dateOfBirth: true, admissionNumber: true } }) : [],
      d.level.findMany({ where: { schoolId } }),
      d.schoolClass.findMany({ where: { schoolId }, select: { id: true, name: true, capacity: true, active: true } }),
      d.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' }, select: { id: true } }),
      d.school.findUnique({ where: { id: schoolId }, select: { maxClassSize: true } }),
    ]);
    const certOwner = new Map(certOwners.map((s) => [s.birthCertificateNumber!, s]));
    const numberOwner = new Map(numberOwners.map((s) => [s.admissionNumber, s]));
    const existingKeys = new Map(sameDob.map((s) => [nameKey({ firstName: s.firstName, surname: s.surname, dateOfBirth: s.dateOfBirth!.toISOString().slice(0, 10) }), s]));
    const levelByName = new Map(levels.map((l) => [l.name, l]));
    const classByName = new Map(classes.map((c) => [c.name.toLowerCase(), c]));
    const occupancy = new Map<string, number>();
    if (term) {
      for (const g of await d.enrollment.groupBy({ by: ['classId'], where: { termId: term.id, status: 'ACTIVE' }, _count: { _all: true } })) occupancy.set(g.classId, g._count._all);
    }

    const seenCert = new Map<string, number>();
    const seenNumber = new Map<string, number>();
    const seenName = new Map<string, number>();
    const incoming = new Map<string, number>();
    const add = (c: CheckedRow, status: RowStatus, message: string) => {
      c.messages.push(message);
      c.status = status === 'ERROR' || c.status === 'ERROR' ? 'ERROR' : 'WARNING';
    };
    for (const c of live) {
      const r = c.clean!;
      if (r.birthCertificateNumber) {
        const owner = certOwner.get(r.birthCertificateNumber);
        if (owner) add(c, 'ERROR', `Birth certificate number is already used by ${owner.fullName} (${owner.admissionNumber})`);
        else if (seenCert.has(r.birthCertificateNumber)) add(c, 'ERROR', `Birth certificate number is also on row ${seenCert.get(r.birthCertificateNumber)}`);
        else seenCert.set(r.birthCertificateNumber, c.rowNumber);
      }
      if (r.admissionNumber) {
        const owner = numberOwner.get(r.admissionNumber);
        if (owner) add(c, 'ERROR', `Admission number ${r.admissionNumber} already belongs to ${owner.fullName}`);
        else if (seenNumber.has(r.admissionNumber)) add(c, 'ERROR', `Admission number is also on row ${seenNumber.get(r.admissionNumber)}`);
        else seenNumber.set(r.admissionNumber, c.rowNumber);
      }
      const key = nameKey(r);
      if (seenName.has(key)) add(c, 'ERROR', `Same name and date of birth as row ${seenName.get(key)}`);
      else seenName.set(key, c.rowNumber);
      const dup = existingKeys.get(key);
      if (dup) add(c, 'WARNING', `A student with the same name and date of birth is already registered (${dup.admissionNumber}). Make sure this is not the same child.`);

      const level = levelByName.get(r.level);
      if (level && !level.active) add(c, 'ERROR', `${r.level} is switched off for this school`);
      const klass = classByName.get(r.className.toLowerCase());
      if (klass && !klass.active) add(c, 'ERROR', `${klass.name} is not in use`);
      else if (!klass) add(c, 'WARNING', `${r.className} does not exist yet and will be created`);
      if (c.status !== 'ERROR') incoming.set(r.className.toLowerCase(), (incoming.get(r.className.toLowerCase()) ?? 0) + 1);
    }
    // Class sizes after the import.
    const flagged = new Set<string>();
    for (const c of live) {
      if (c.status === 'ERROR') continue;
      const klass = classByName.get(c.clean!.className.toLowerCase());
      const capacity = klass?.capacity ?? school?.maxClassSize ?? 45;
      const after = (klass ? occupancy.get(klass.id) ?? 0 : 0) + (incoming.get(c.clean!.className.toLowerCase()) ?? 0);
      if (after > capacity && !flagged.has(c.clean!.className)) {
        flagged.add(c.clean!.className);
        add(c, 'WARNING', `${c.clean!.className} will have ${after} students after this import; its capacity is ${capacity}`);
      }
    }
    return checked;
  };
  return db ? run(db) : run(getScopedDb(user.schoolId, user.id) as unknown as Db);
}

export function importSummary(rows: CheckedRow[]) {
  return { total: rows.length, ok: rows.filter((r) => r.status === 'OK').length, warnings: rows.filter((r) => r.status === 'WARNING').length, errors: rows.filter((r) => r.status === 'ERROR').length };
}

// ─── The import ──────────────────────────────────────────────────────────────

export const ImportBodySchema = z.object({
  rows: z.array(z.object({ rowNumber: z.number().int().min(2).max(100_000), values: z.record(z.string(), z.string().max(300)) })).min(1).max(MAX_IMPORT_ROWS),
});

export interface ImportResult {
  imported: number;
  skipped: number;
  guardiansCreated: number;
  guardiansShared: number;
  classesCreated: string[];
  /** CSV of the rows that were not imported and why. */
  reportCsv: string;
  summary: ReturnType<typeof importSummary>;
}

export function skippedReportCsv(rows: CheckedRow[]): string {
  return toCsv(['Row', 'Student', 'Status', 'Reason'], rows.filter((r) => r.status === 'ERROR').map((r) => [r.rowNumber, r.name, r.status, r.messages.join('; ')]));
}

/** Imports every row that is not an Error, in one transaction. Either all of them are saved or none. */
export async function importStudents(user: AccessUser & { fullName?: string }, body: z.input<typeof ImportBodySchema>): Promise<ImportResult> {
  const input = ImportBodySchema.parse(body);
  const { schoolId } = user;

  return withAdmissionNumberRetry(() =>
    getScopedDb(schoolId, user.id).$tx(async (tx) => {
      const term = await tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' } });
      if (!term) throw new ServiceError('No term is open. Open a term under System, Settings, Academic years first.', 409);
      const checked = await checkImportRows(user, input.rows as { rowNumber: number; values: ImportRow }[], tx);
      const summary = importSummary(checked);
      const good = checked.filter((c) => c.status !== 'ERROR' && c.clean);
      const report = skippedReportCsv(checked);
      if (good.length === 0) throw new ServiceError('None of the rows can be imported. Fix the errors and try again.', 422);

      // Classes: create the ones that do not exist yet.
      const classes = new Map((await tx.schoolClass.findMany({ where: { schoolId }, select: { id: true, name: true } })).map((c) => [c.name.toLowerCase(), c.id]));
      const levels = new Map((await tx.level.findMany({ where: { schoolId } })).map((l) => [l.name, l.id]));
      const school = await tx.school.findUniqueOrThrow({ where: { id: schoolId }, select: { maxClassSize: true } });
      const created: string[] = [];
      for (const c of good) {
        const key = c.clean!.className.toLowerCase();
        if (classes.has(key)) continue;
        let levelId = levels.get(c.clean!.level);
        if (!levelId) {
          const order = Number(c.clean!.level.slice(-1));
          levelId = (await tx.level.create({ data: { schoolId, name: c.clean!.level, order, category: order > 4 ? 'A_LEVEL' : 'O_LEVEL' } })).id;
          levels.set(c.clean!.level, levelId);
        }
        const klass = await tx.schoolClass.create({ data: { schoolId, name: c.clean!.className, levelId, stream: c.clean!.stream, capacity: school.maxClassSize } });
        classes.set(key, klass.id);
        created.push(klass.name);
        await logAudit({ schoolId, actorId: user.id, action: 'CREATE_CLASS', entityType: 'SchoolClass', entityId: klass.id, detail: `${klass.name} (created by the student import)` }, tx);
      }

      // Admission numbers: those given in the file are kept; the rest follow the school's format.
      const years = Array.from(new Set(good.map((c) => Number(c.clean!.admissionDate.slice(0, 4)))));
      const sequences = await nextSequences(tx, schoolId, years);
      const taken = new Set(good.flatMap((c) => (c.clean!.admissionNumber ? [c.clean!.admissionNumber] : [])));
      const students = good.map((c) => {
        const r = c.clean!;
        const year = Number(r.admissionDate.slice(0, 4));
        return { row: c, data: r, admissionNumber: r.admissionNumber ?? takeAdmissionNumber(sequences, year, taken) };
      });

      const rowsCreated = await tx.student.createManyAndReturn({
        data: students.map((s) => ({
          schoolId, admissionNumber: s.admissionNumber, firstName: s.data.firstName, surname: s.data.surname, fullName: `${s.data.firstName} ${s.data.surname}`,
          gender: s.data.gender, dateOfBirth: dateOnly(s.data.dateOfBirth), birthCertificateNumber: s.data.birthCertificateNumber, admissionDate: dateOnly(s.data.admissionDate),
          boarding: s.data.boarding, address: s.data.address, status: 'ACTIVE' as const, currentClassId: classes.get(s.data.className.toLowerCase())!,
        })),
        select: { id: true, admissionNumber: true },
      });
      const idByNumber = new Map(rowsCreated.map((s) => [s.admissionNumber, s.id]));
      await tx.enrollment.createMany({
        data: students.map((s) => {
          const admitted = dateOnly(s.data.admissionDate);
          return { schoolId, studentId: idByNumber.get(s.admissionNumber)!, classId: classes.get(s.data.className.toLowerCase())!, termId: term.id, status: 'ACTIVE' as const, startDate: admitted > term.startDate ? admitted : term.startDate, reason: 'Imported' };
        }),
      });
      await tx.libraryMember.createMany({ data: students.map((s) => ({ schoolId, studentId: idByNumber.get(s.admissionNumber)!, memberType: 'STUDENT' as const })), skipDuplicates: true });

      // Guardians with the same phone number become one record.
      const byPhone = new Map<string, (typeof students)[number]['data']>();
      for (const s of students) if (!byPhone.has(s.data.guardianPhone)) byPhone.set(s.data.guardianPhone, s.data);
      const existing = await tx.guardian.findMany({ where: { phone: { in: Array.from(byPhone.keys()) } }, select: { id: true, phone: true } });
      const guardianId = new Map(existing.map((g) => [g.phone, g.id]));
      const toCreate = Array.from(byPhone.entries()).filter(([phone]) => !guardianId.has(phone));
      if (toCreate.length) {
        const made = await tx.guardian.createManyAndReturn({
          data: toCreate.map(([phone, r]) => ({ schoolId, fullName: r.guardianName, phone, altPhone: r.guardianPhone2, address: r.address })),
          select: { id: true, phone: true },
        });
        for (const g of made) guardianId.set(g.phone, g.id);
      }
      await tx.studentGuardian.createMany({
        data: students.map((s) => ({
          studentId: idByNumber.get(s.admissionNumber)!, guardianId: guardianId.get(s.data.guardianPhone)!, relationship: s.data.relationship, relationshipNote: s.data.relationshipNote,
          isPrimary: true, isFeePayer: true, canReceiveSms: true, canCollect: true,
        })),
      });

      await tx.auditLog.createMany({
        data: students.map((s) => ({
          schoolId, actorId: user.id, action: 'ADMIT_STUDENT' as const, entityType: 'Student', entityId: idByNumber.get(s.admissionNumber)!,
          detail: `${s.admissionNumber} ${s.data.firstName} ${s.data.surname}, ${s.data.className} (imported)`,
          after: { admissionNumber: s.admissionNumber, classId: classes.get(s.data.className.toLowerCase())!, source: 'import', row: s.row.rowNumber } as Prisma.InputJsonValue,
        })),
      });
      await logAudit(
        {
          schoolId, actorId: user.id, action: 'IMPORT_STUDENTS', entityType: 'Student', entityId: 'import',
          detail: `${students.length} student(s) imported, ${summary.errors} skipped`,
          after: { imported: students.length, skipped: summary.errors, warnings: summary.warnings, classesCreated: created },
        },
        tx,
      );
      return {
        imported: students.length, skipped: summary.errors, guardiansCreated: toCreate.length, guardiansShared: students.length - byPhone.size,
        classesCreated: created, reportCsv: report, summary,
      };
    }, { timeout: 120_000, maxWait: 20_000 }),
  );
}

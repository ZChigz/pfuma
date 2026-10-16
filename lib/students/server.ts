// Server-only helpers for admission (form + CSV import) and classes.
import { Prisma } from '@prisma/client';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { ensureStudentMember } from '@/lib/library';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { classDisplayName } from '@/lib/academic/rules';
import { counterPattern, DEFAULT_ADMISSION_FORMAT, formatNumber, maxCounter } from '@/lib/numbering';
import { dateOnly, ensureLevels, getOpenTerm, requireOpenTerm } from '@/lib/academic/terms';
import { findOrCreateGuardian, linkGuardian } from '@/lib/students/guardians';
import {
  ageWarning,
  DEFAULT_MAX_CLASS_SIZE,
  type AdmissionData,
  type RegistrationWarning,
} from '@/lib/students/registration';

type Tx = Db;

export const dobToDate = dateOnly;

// ─── Classes ─────────────────────────────────────────────────────────────────

export async function levelByName(schoolId: string, levelName: string, db: Db) {
  const level = await db.level.findUnique({ where: { schoolId_name: { schoolId, name: levelName } } });
  if (level) return level;
  const levels = await ensureLevels(schoolId, db);
  const found = levels.find((l) => l.name === levelName);
  if (!found) throw new ServiceError(`Unknown level ${levelName}`, 422);
  return found;
}

export async function findClass(schoolId: string, levelName: string, stream: string, db: Db) {
  return db.schoolClass.findFirst({
    where: { schoolId, level: { name: levelName }, stream: { equals: stream, mode: 'insensitive' } },
    include: { level: true },
  });
}

export async function findOrCreateClass(tx: Tx, schoolId: string, actorId: string, levelName: string, stream: string) {
  const existing = await findClass(schoolId, levelName, stream, tx);
  if (existing) return existing;

  const [level, school] = await Promise.all([
    levelByName(schoolId, levelName, tx),
    tx.school.findUnique({ where: { id: schoolId }, select: { maxClassSize: true } }),
  ]);
  if (!level.active) throw new ServiceError(`${level.name} is switched off for this school. Switch it on under Settings → Forms, streams and classes first.`, 409);
  const name = classDisplayName(level.name, stream);
  const created = await tx.schoolClass.create({
    data: { schoolId, name, levelId: level.id, stream, capacity: school?.maxClassSize ?? DEFAULT_MAX_CLASS_SIZE },
    include: { level: true },
  });
  await logAudit(
    { schoolId, actorId, action: 'CREATE_CLASS', entityType: 'SchoolClass', entityId: created.id, detail: `${name} (created automatically)` },
    tx,
  );
  return created;
}

// Students currently in a class = ACTIVE enrollments in the open term.
export async function classOccupancy(classId: string | null | undefined, termId: string | null | undefined, db: Db) {
  if (!classId || !termId) return 0;
  return db.enrollment.count({ where: { classId, termId, status: 'ACTIVE' } });
}

// ─── Duplicates & warnings ───────────────────────────────────────────────────

export async function findDuplicate(schoolId: string, firstName: string, surname: string, dateOfBirth: string, db: Db) {
  return db.student.findFirst({
    where: {
      schoolId,
      firstName:   { equals: firstName, mode: 'insensitive' },
      surname:     { equals: surname,   mode: 'insensitive' },
      dateOfBirth: dobToDate(dateOfBirth),
    },
    select: { id: true, admissionNumber: true, fullName: true, currentClass: { select: { name: true } } },
  });
}

export function duplicateMessage(dup: { admissionNumber: string; fullName: string; currentClass: { name: string } | null }): string {
  const where = dup.currentClass ? ` in ${dup.currentClass.name}` : '';
  return `A student with the same name and date of birth is already registered: ${dup.fullName} (${dup.admissionNumber})${where}. Make sure this is not the same child.`;
}

export function classFullMessage(name: string, current: number, capacity: number): string {
  return `${name} already has ${current} students and its capacity is ${capacity}. Adding this student will make it ${current + 1}.`;
}

export interface RegistrationCheck {
  className: string;
  classExists: boolean;
  classCount: number;
  capacity: number;
  termName: string | null;
  warnings: RegistrationWarning[];
}

export async function checkRegistration(schoolId: string, data: AdmissionData, db: Db): Promise<RegistrationCheck> {
  const [schoolClass, school, duplicate, term] = await Promise.all([
    findClass(schoolId, data.level, data.stream, db),
    db.school.findUnique({ where: { id: schoolId }, select: { maxClassSize: true } }),
    findDuplicate(schoolId, data.firstName, data.surname, data.dateOfBirth, db),
    getOpenTerm(schoolId, db),
  ]);
  const classCount = await classOccupancy(schoolClass?.id, term?.id, db);
  const capacity = schoolClass?.capacity ?? school?.maxClassSize ?? DEFAULT_MAX_CLASS_SIZE;
  const name = schoolClass?.name ?? data.className;

  const warnings: RegistrationWarning[] = [];
  const age = ageWarning(data.dateOfBirth, data.level);
  if (age) warnings.push({ code: 'AGE_OUT_OF_RANGE', message: age });
  if (classCount + 1 > capacity) warnings.push({ code: 'CLASS_FULL', message: classFullMessage(name, classCount, capacity) });
  if (duplicate) warnings.push({ code: 'POSSIBLE_DUPLICATE', message: duplicateMessage(duplicate) });

  return { className: name, classExists: !!schoolClass, classCount, capacity, termName: term?.name ?? null, warnings };
}

// ─── Admission numbers ───────────────────────────────────────────────────────

// The next free running number for each admission year, e.g. { 2026: 14 }, worked out from the
// school's admission-number format (Settings → Numbering): the highest number already used in
// that year, plus one. The format travels with the map so takeAdmissionNumber builds the same shape.
export type AdmissionSequences = Map<number, number> & { config: { format: string; code: string } };

export async function nextSequences(tx: Tx, schoolId: string, years: number[]): Promise<AdmissionSequences> {
  const school = await tx.school.findUnique({ where: { id: schoolId }, select: { admissionFormat: true, schoolCode: true } });
  const config = { format: school?.admissionFormat ?? DEFAULT_ADMISSION_FORMAT, code: school?.schoolCode ?? 'STU' };
  const result = Object.assign(new Map<number, number>(), { config }) as AdmissionSequences;
  for (const year of Array.from(new Set(years))) {
    const pattern = counterPattern(config.format, { year, schoolCode: config.code });
    let lastSeq = 0;
    if (pattern) {
      // Fixed-width numbers sort the same as text, so the highest used is near the top.
      const candidates = await tx.student.findMany({
        where: { schoolId, admissionNumber: { startsWith: pattern.prefix } },
        orderBy: { admissionNumber: 'desc' },
        select: { admissionNumber: true },
        take: 200,
      });
      for (const c of candidates) {
        const m = pattern.regex.exec(c.admissionNumber);
        if (m) lastSeq = Math.max(lastSeq, Number(m[1]));
      }
    }
    result.set(year, lastSeq + 1);
  }
  return result;
}

export function takeAdmissionNumber(sequences: Map<number, number>, year: number, taken: Set<string> = new Set()): string {
  const config = (sequences as Partial<AdmissionSequences>).config ?? { format: DEFAULT_ADMISSION_FORMAT, code: 'STU' };
  const limit = maxCounter(config.format);
  let seq = sequences.get(year) ?? 1;
  const build = (n: number) => formatNumber(config.format, { year, schoolCode: config.code }, n);
  if (seq > limit) throw new ServiceError(`All ${limit} admission numbers for ${year} are used. Change the format under Settings → Numbering.`, 409);
  let candidate = build(seq);
  while (taken.has(candidate)) {
    seq++;
    if (seq > limit) throw new ServiceError(`All ${limit} admission numbers for ${year} are used. Change the format under Settings → Numbering.`, 409);
    candidate = build(seq);
  }
  sequences.set(year, seq + 1);
  return candidate;
}

export function isUniqueClash(e: unknown, field: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
  return String(e.meta?.target ?? '').includes(field);
}

// Runs fn, retrying when a concurrent admission took the same admission number.
export async function withAdmissionNumberRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (isUniqueClash(e, 'birthCertificateNumber')) {
        throw new ServiceError('Another student already has this birth certificate number', 409);
      }
      if (i >= attempts || !isUniqueClash(e, 'admissionNumber')) throw e;
    }
  }
}

// ─── Admission ───────────────────────────────────────────────────────────────

// Admit: Student + primary Guardian link + ACTIVE Enrollment in the open term,
// written in the caller's transaction with one ADMIT_STUDENT audit row.
export async function admitStudent(
  tx: Tx,
  schoolId: string,
  actorId: string,
  data: AdmissionData,
  opts: { admissionNumber: string; termId: string; classId: string; className: string; auditNote?: string },
) {
  const student = await tx.student.create({
    data: {
      schoolId,
      admissionNumber:        opts.admissionNumber,
      firstName:              data.firstName,
      surname:                data.surname,
      fullName:               data.fullName,
      gender:                 data.gender,
      dateOfBirth:            dateOnly(data.dateOfBirth),
      birthCertificateNumber: data.birthCertificateNumber,
      admissionDate:          dateOnly(data.admissionDate),
      previousSchool:         data.previousSchool,
      medicalNotes:           data.medicalNotes,
      photoUrl:               data.photoUrl,
      houseNumber:            data.houseNumber,
      suburb:                 data.suburb,
      city:                   data.city,
      address:                data.address,
      status:                 'ACTIVE',
      currentClassId:         opts.classId,
    },
  });

  // Every admitted student can borrow books.
  await ensureStudentMember(tx, schoolId, actorId, student.id);

  const term = await tx.academicTerm.findUniqueOrThrow({ where: { id: opts.termId } });
  const admitted = dateOnly(data.admissionDate);
  await tx.enrollment.create({
    data: {
      schoolId,
      studentId: student.id,
      classId: opts.classId,
      termId: opts.termId,
      status: 'ACTIVE',
      startDate: admitted > term.startDate ? admitted : term.startDate,
    },
  });

  const guardian = await findOrCreateGuardian(tx, schoolId, actorId, data.guardian);
  await linkGuardian(tx, schoolId, actorId, student.id, guardian.id, {
    relationship: data.relationship,
    relationshipNote: data.relationshipNote,
    isPrimary: true,
    isFeePayer: true,
    canReceiveSms: true,
  });

  await logAudit(
    {
      schoolId,
      actorId,
      action: 'ADMIT_STUDENT',
      entityType: 'Student',
      entityId: student.id,
      detail: `${opts.admissionNumber} ${data.fullName} — ${opts.className}${opts.auditNote ? ` (${opts.auditNote})` : ''}`,
    },
    tx,
  );
  return student;
}

// Admits one student from the form: class found or created, number generated.
export async function admitFromForm(schoolId: string, actorId: string, data: AdmissionData, auditNote?: string) {
  return withAdmissionNumberRetry(() =>
    getScopedDb(schoolId, actorId).$tx(async (tx) => {
      const term = await requireOpenTerm(schoolId, tx);
      const schoolClass = await findOrCreateClass(tx, schoolId, actorId, data.level, data.stream);
      const year = Number(data.admissionDate.slice(0, 4));
      const admissionNumber = data.admissionNumber ?? takeAdmissionNumber(await nextSequences(tx, schoolId, [year]), year);
      const student = await admitStudent(tx, schoolId, actorId, data, {
        admissionNumber, termId: term.id, classId: schoolClass.id, className: schoolClass.name, auditNote,
      });
      return { ...student, currentClass: { id: schoolClass.id, name: schoolClass.name } };
    }),
  );
}
